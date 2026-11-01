import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heartRateTarget, qualityRunFormat } from "../domain/qualityRun";
import { runType } from "../domain/runType";
import type { WorkoutDay } from "../domain/weekPlan";
import {
  eventVersion,
  isNsmEvent,
  isOwnedEvent,
  plannedEasyHrTarget,
  plannedRecovery,
  weekPlanDay,
  type IntervalsClient,
  type IntervalsEvent,
} from "./intervals";
import { createIntervalsDestination, workoutEvent } from "./intervalsDestination";
import { createApp, type WeekResponse } from "./app";
import { openDb } from "./db";
import type { PlanDestination } from "./planDestination";
import { loadPlannedWorkouts } from "./store";
import { sync } from "./sync";
import type { SyncRunner } from "./syncRunner";

/** A recorded week of the NSM app's Planned Workouts (26 Oct 2026), trimmed of load and zone totals. */
const nsmWeek = JSON.parse(
  readFileSync(new URL("./fixtures/intervals/nsm-week-2026-10-26.json", import.meta.url), "utf8"),
) as (IntervalsEvent & { workout_doc: unknown })[];

interface Step {
  duration?: number;
  hr?: { start: number; end: number; units: string };
  intensity?: string;
  warmup?: boolean;
  cooldown?: boolean;
  reps?: number;
  steps?: Step[];
}

/**
 * The `workout_doc` intervals.icu builds from workout text, for the steps the NSM app writes: "- 10m 62-70% HR …",
 * a "7x" line starting a repeated block that a blank line ends, and `intensity=` and `hr=` options.
 */
function workoutDocOf(description: string): { steps: Step[]; duration: number } {
  const steps: Step[] = [];
  let block: Step | null = null;
  for (const line of description.split("\n")) {
    const repeat = /^(\d+)x$/.exec(line.trim());
    if (repeat) {
      block = { reps: Number(repeat[1]), steps: [] };
      steps.push(block);
    } else if (line.trim() === "") {
      block = null;
    } else if (line.startsWith("- ")) {
      const time = /^- (?:(\d+)m)?(?:(\d+)s)?\s/.exec(line)!;
      const step: Step = { duration: Number(time[1] ?? 0) * 60 + Number(time[2] ?? 0) };
      const hr = /(\d+)-(\d+)% (HR|LTHR)/.exec(line);
      if (hr) step.hr = { start: Number(hr[1]), end: Number(hr[2]), units: hr[3] === "HR" ? "%hr" : "%lthr" };
      const intensity = /intensity=(\w+)/.exec(line)?.[1];
      if (intensity) step.intensity = intensity;
      if (intensity === "warmup") step.warmup = true;
      if (intensity === "cooldown") step.cooldown = true;
      (block?.steps ?? steps).push(step);
    }
  }
  const total = (s: Step): number => (s.reps ? s.reps * s.steps!.reduce((sum, x) => sum + total(x), 0) : s.duration!);
  for (const s of steps) if (s.reps) s.duration = total(s);
  return { steps, duration: steps.reduce((sum, s) => sum + total(s), 0) };
}

/** What intervals.icu stores for a pushed workout: the payload with the structure it reads from the description. */
function stored(payload: ReturnType<typeof workoutEvent>, id = 1): IntervalsEvent {
  return { id, paired_activity_id: null, ...payload, workout_doc: workoutDocOf(payload.description) };
}

const targets = { lthr: 181, easyHrTarget: { low: 62, high: 70 } };

describe("workoutDocOf, the test's reading of workout text", () => {
  it("builds the structure intervals.icu built for each recorded NSM-app workout", () => {
    for (const e of nsmWeek) expect(e.workout_doc).toMatchObject(workoutDocOf(e.description!));
  });
});

describe("workoutEvent", () => {
  it("writes each recorded NSM-app workout exactly as the NSM app did, at LTHR 181", () => {
    for (const e of nsmWeek) {
      const date = e.start_date_local.slice(0, 10);
      const payload = workoutEvent(date, weekPlanDay(e)!, targets);
      expect(payload).toMatchObject({
        category: e.category,
        type: e.type,
        start_date_local: e.start_date_local,
        name: e.name,
        description: e.description,
      });
    }
  });

  it("marks the workout as this app's, and tagged [NSM], so sync and Matching read it like the NSM app's", () => {
    const event = stored(workoutEvent("2026-11-02", { kind: "Easy Run", duration: 2400 }, targets));
    expect(isOwnedEvent(event)).toBe(true);
    expect(isNsmEvent(event)).toBe(true);
    for (const e of nsmWeek) expect(isOwnedEvent(e)).toBe(false);
  });

  const days: WorkoutDay[] = [
    { kind: "Quality Run", reps: 5, repLength: 360, recovery: 90, warmUp: 900, coolDown: 600 },
    { kind: "Quality Run", reps: 1, repLength: 1200, recovery: 0, warmUp: 0, coolDown: 0 },
    { kind: "Quality Run", reps: 8, repLength: 150, recovery: 45, warmUp: 630, coolDown: 600 },
    { kind: "Easy Run", duration: 45 * 60 },
    { kind: "Long Run", duration: 95 * 60 },
  ];

  it("reads back through the existing readers as exactly the day planned", () => {
    for (const day of days) {
      const event = stored(workoutEvent("2026-11-03", day, { lthr: 185, easyHrTarget: { low: 60, high: 68 } }));
      expect(weekPlanDay(event)).toEqual(day);
      expect(runType(event.name)).toBe(day.kind);
      if (day.kind === "Quality Run") {
        expect(qualityRunFormat(event.name)).toEqual({ reps: day.reps, repLength: day.repLength });
        // 90% and 98% of LTHR 185, rounded: 166.5 and 181.3.
        expect(heartRateTarget(event.name)).toEqual({ low: 167, high: 181 });
        expect(plannedRecovery(event)).toBe(day.recovery === 0 ? null : day.recovery);
      }
      expect(plannedEasyHrTarget(event)).toEqual(day.kind === "Quality Run" && day.warmUp === 0 ? null : { low: 60, high: 68 });
    }
  });
});

/**
 * An intervals.icu calendar held in memory: it stores what is created and updated as intervals.icu would, building the
 * structure from the workout text, and records each write as "create date", "update id" or "delete id".
 * `fail` makes a write fail when it returns true.
 */
function fakeCalendar(events: IntervalsEvent[], fail: (write: string) => boolean = () => false) {
  const calendar = events.map((e) => ({ ...e }));
  const writes: string[] = [];
  let nextId = 1000;
  const write = (what: string) => {
    if (fail(what)) throw new Error(`intervals.icu ${what} failed: 500 Internal Server Error`);
    writes.push(what);
  };
  const unused = async (): Promise<never> => {
    throw new Error("not used");
  };
  const client: IntervalsClient = {
    events: async (oldest, newest) =>
      calendar.filter((e) => e.start_date_local.slice(0, 10) >= oldest && e.start_date_local.slice(0, 10) <= newest),
    activities: async () => [],
    activity: async () => null,
    intervals: unused,
    streams: unused,
    athlete: async () => ({}),
    createEvent: async (payload) => {
      const p = payload as ReturnType<typeof workoutEvent>;
      write(`create ${p.start_date_local.slice(0, 10)}`);
      const e = { ...stored(p, nextId++), updated: "2026-11-01T12:00:00Z" };
      calendar.push(e);
      return e;
    },
    updateEvent: async (id, payload) => {
      write(`update ${id}`);
      const i = calendar.findIndex((e) => e.id === id);
      calendar[i] = { ...calendar[i]!, ...stored(payload as ReturnType<typeof workoutEvent>, id) };
      return calendar[i]!;
    },
    deleteEvent: async (id) => {
      write(`delete ${id}`);
      calendar.splice(calendar.findIndex((e) => e.id === id), 1);
    },
  };
  return { client, calendar, writes };
}

describe("the intervals.icu plan destination", () => {
  const quality: WorkoutDay = { kind: "Quality Run", reps: 4, repLength: 360, recovery: 90, warmUp: 600, coolDown: 600 };
  const easy: WorkoutDay = { kind: "Easy Run", duration: 45 * 60 };
  const rest = { kind: "Rest" } as const;
  const week = [
    { date: "2026-11-02", day: quality },
    { date: "2026-11-03", day: easy },
    { date: "2026-11-04", day: rest },
  ];
  const push = (destination: PlanDestination, days = week, replaceNsmApp = false) =>
    destination.push({ days, targets, replaceNsmApp });
  const race: IntervalsEvent = {
    id: 1,
    start_date_local: "2026-11-03T09:00:00",
    category: "WORKOUT",
    type: "Run",
    name: "Turkey Trot",
    description: "race day",
    paired_activity_id: null,
  };

  it("creates one workout of this app's per workout day, none for rest, and reports each day", async () => {
    const { client, calendar } = fakeCalendar([]);
    const result = await push(createIntervalsDestination(client));

    expect(calendar.map((e) => [e.start_date_local.slice(0, 10), e.name, isOwnedEvent(e)])).toEqual([
      ["2026-11-02", "4 x 6:00 at 163–177 bpm", true],
      ["2026-11-03", "Easy Run", true],
    ]);
    expect(result).toEqual({
      outcome: "Pushed",
      days: [
        { date: "2026-11-02", eventId: "1000", version: eventVersion(calendar[0]!) },
        { date: "2026-11-03", eventId: "1001", version: eventVersion(calendar[1]!) },
        { date: "2026-11-04", eventId: null, version: null },
      ],
      replaced: [],
    });
  });

  it("pushing again updates its own workouts in place and removes the one of a day changed to rest", async () => {
    const { client, calendar, writes } = fakeCalendar([]);
    const destination = createIntervalsDestination(client);
    await push(destination);
    writes.length = 0;

    await push(destination, [
      { date: "2026-11-02", day: { ...quality, reps: 3 } },
      { date: "2026-11-03", day: rest },
      { date: "2026-11-04", day: easy },
    ]);

    expect(writes).toEqual(["update 1000", "delete 1001", "create 2026-11-04"]);
    expect(calendar.map((e) => e.name)).toEqual(["3 x 6:00 at 163–177 bpm", "Easy Run"]);
  });

  it("never touches a workout it did not make, or a day it was not given", async () => {
    const pastNsmApp = { ...nsmWeek[0]!, start_date_local: "2026-11-01T12:00:00" };
    const { client, calendar, writes } = fakeCalendar([race, pastNsmApp]);
    await push(createIntervalsDestination(client), [{ date: "2026-11-03", day: rest }, ...week.slice(0, 1)]);
    expect(writes).toEqual(["create 2026-11-02"]);
    expect(calendar).toContainEqual(race);
    expect(calendar).toContainEqual(pastNsmApp);
  });

  it("returns NSM-app workouts on the days for confirmation and changes nothing, or replaces them once confirmed", async () => {
    const nsmApp = { ...nsmWeek[1]!, start_date_local: "2026-11-03T12:00:00" };
    const { client, calendar, writes } = fakeCalendar([nsmApp]);
    const destination = createIntervalsDestination(client);

    expect(await push(destination)).toEqual({
      outcome: "ConfirmReplace",
      nsmAppWorkouts: [{ id: String(nsmApp.id), date: "2026-11-03", name: "Easy Run" }],
    });
    expect(writes).toEqual([]);

    const result = await push(destination, week, true);
    expect(result).toMatchObject({ outcome: "Pushed", replaced: [{ id: String(nsmApp.id) }] });
    expect(writes).toEqual(["create 2026-11-02", `delete ${nsmApp.id}`, "create 2026-11-03"]);
    expect(calendar.every(isOwnedEvent)).toBe(true);
  });

  it("stops at an intervals.icu error with its message, and pushing again finishes the week without duplicates", async () => {
    let failing = true;
    const { client, calendar } = fakeCalendar([], (write) => failing && write === "create 2026-11-03");
    const destination = createIntervalsDestination(client);

    const failed = await push(destination);
    expect(failed).toEqual({
      outcome: "Failed",
      days: [{ date: "2026-11-02", eventId: "1000", version: eventVersion(calendar[0]!) }],
      error: "intervals.icu create 2026-11-03 failed: 500 Internal Server Error",
    });

    failing = false;
    expect(await push(destination)).toMatchObject({ outcome: "Pushed" });
    expect(calendar.map((e) => e.start_date_local.slice(0, 10))).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("fails without changing anything when a Quality Run is planned but intervals.icu has no LTHR", async () => {
    const { client, writes } = fakeCalendar([]);
    const result = await createIntervalsDestination(client).push({ days: week, targets: { ...targets, lthr: null }, replaceNsmApp: false });
    expect(result).toMatchObject({ outcome: "Failed", days: [], error: expect.stringContaining("LTHR") });
    expect(writes).toEqual([]);
  });
});

describe("after a push and a sync", () => {
  it("the pushed workouts are Planned Workouts with their Run Types and targets, like the NSM app's", async () => {
    // The NSM app planned 26 Oct; this app pushes Monday 2 and Tuesday 3 Nov.
    const { client } = fakeCalendar(nsmWeek);
    await createIntervalsDestination(client).push({
      days: [
        { date: "2026-11-02", day: { kind: "Quality Run", reps: 3, repLength: 600, recovery: 120, warmUp: 600, coolDown: 600 } },
        { date: "2026-11-03", day: { kind: "Easy Run", duration: 50 * 60 } },
      ],
      targets: { lthr: 183, easyHrTarget: { low: 60, high: 68 } },
      replaceNsmApp: false,
    });
    const db = openDb(":memory:");
    await sync(db, client, "2026-11-01");

    const week = (await (await createApp(db, () => "2026-11-01", idleRunner()).request("/api/week?date=2026-11-02")).json()) as WeekResponse;
    expect(week.days.slice(0, 2).map((d) => d.workouts.map((w) => [w.plannedWorkout.name, w.runType, w.status]))).toEqual([
      [["3 x 10:00 at 165–179 bpm", "Quality Run", "Upcoming"]],
      [["Easy Run", "Easy Run", "Upcoming"]],
    ]);
    const stored = loadPlannedWorkouts(db).filter((p) => p.date >= "2026-11-02");
    expect(stored.map((p) => [plannedRecovery(p.raw), plannedEasyHrTarget(p.raw)])).toEqual([
      [120, { low: 60, high: 68 }],
      [null, { low: 60, high: 68 }],
    ]);
  });
});

function idleRunner(): SyncRunner {
  return { run: async () => {}, running: false };
}
