import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "../domain/localDate";
import type { WeekPlanDay } from "../domain/weekPlan";
import { createApp, type PlannerSettingsResponse, type PlanResponse, type PushResponse } from "./app";
import { openDb, type Db } from "./db";
import type { IntervalsActivity, IntervalsEvent } from "./intervals";
import { workoutEvent } from "./intervalsDestination";
import { loadWeekPlan, saveAthleteSettings, saveSync, saveWeekPlan } from "./store";
import type { DatedDay } from "../domain/weekPlan";
import type { NsmAppWorkout, PlanDestination, PlanDestinationResult, WorkoutTargets } from "./planDestination";
import type { SyncRunner } from "./syncRunner";

/** A recorded week of the NSM app's Planned Workouts, Monday 26 Oct to Saturday 31 Oct 2026. */
const nsmWeek = JSON.parse(
  readFileSync(new URL("./fixtures/intervals/nsm-week-2026-10-26.json", import.meta.url), "utf8"),
) as IntervalsEvent[];

/** The recorded NSM week moved `weeks` Training Weeks on, with new ids. */
function nsmWeekShifted(weeks: number): IntervalsEvent[] {
  return nsmWeek.map((e) => ({
    ...e,
    id: e.id + weeks,
    start_date_local: `${addDays(e.start_date_local.slice(0, 10), 7 * weeks)}${e.start_date_local.slice(10)}`,
    external_id: `nsm-${addDays(e.start_date_local.slice(0, 10), 7 * weeks)}`,
    paired_activity_id: null,
  }));
}

const rest: WeekPlanDay = { kind: "Rest" };
/** The recorded NSM week as Week Plan days, Monday first. */
const recordedWeek: WeekPlanDay[] = [
  { kind: "Quality Run", reps: 2, repLength: 600, recovery: 120, warmUp: 600, coolDown: 600 },
  { kind: "Easy Run", duration: 47 * 60 },
  { kind: "Quality Run", reps: 4, repLength: 360, recovery: 90, warmUp: 600, coolDown: 600 },
  { kind: "Easy Run", duration: 47 * 60 },
  { kind: "Quality Run", reps: 7, repLength: 180, recovery: 60, warmUp: 600, coolDown: 600 },
  { kind: "Long Run", duration: 83 * 60 },
  rest,
];

function sync(db: Db, events: IntervalsEvent[], activities: IntervalsActivity[] = []) {
  saveSync(db, { from: "2026-10-01", to: "2026-11-30" }, events, activities, new Map(), {
    finishedAt: "2026-11-01T12:00:00.000Z",
    syncedThrough: "2026-11-01",
  });
}

function idleRunner(): SyncRunner {
  return { run: async () => {}, running: false };
}

async function plan(app: ReturnType<typeof createApp>, week?: string): Promise<PlanResponse> {
  const res = await app.request(week === undefined ? "/api/plan" : `/api/plan?week=${week}`);
  expect(res.status).toBe(200);
  return (await res.json()) as PlanResponse;
}

describe("GET /api/plan", () => {
  // Sunday 1 Nov 2026: the usual Sunday planning of next Training Week, Monday 2 Nov.
  const today = "2026-11-01";

  it("opens on next Training Week as a Draft, imported from the previous week's NSM-app workouts", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const week = await plan(createApp(db, () => today, idleRunner()));

    expect(week).toMatchObject({ week: "2026-11-02", current: "2026-10-26", next: "2026-11-02", status: "Draft" });
    expect(week.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(week.days.map((d) => d.day)).toEqual(recordedWeek);
  });

  it("imports the week's own NSM-app workouts when it already holds some", async () => {
    const db = openDb(":memory:");
    const nextWeek = nsmWeekShifted(1).filter((e) => e.name !== "Long Run");
    sync(db, [...nsmWeek, ...nextWeek]);
    const week = await plan(createApp(db, () => today, idleRunner()));
    expect(week.days.map((d) => d.day)).toEqual([...recordedWeek.slice(0, 5), rest, rest]);
  });

  it("stores the Week Plan on first open, so a reload shows the same one", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const app = createApp(db, () => today, idleRunner());
    const first = await plan(app);
    sync(db, []);
    const reloaded = await plan(app);
    expect(reloaded.days).toEqual(first.days);
    expect(reloaded.status).toBe("Draft");
  });

  it("summarises total planned time, Planned Rep time and Planned Quality Share", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const { summary } = await plan(createApp(db, () => today, idleRunner()));
    // Quality Runs 42:00 + 48:30 + 47:00, easy days 47 + 47 + 83: 314:30; Reps 20 + 24 + 21 = 65:00, 21%.
    expect(summary).toMatchObject({ plannedTime: 314 * 60 + 30, repTime: 65 * 60, plannedQualityShare: 21 });
  });
});

async function saveDraft(app: ReturnType<typeof createApp>, week: string, days: WeekPlanDay[]) {
  return app.request(`/api/plan/${week}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days }),
  });
}

describe("editing a Week Plan draft", () => {
  // Wednesday 4 Nov 2026: Monday 2 and Tuesday 3 Nov have passed.
  const today = "2026-11-04";
  const easy = (minutes: number): WeekPlanDay => ({ kind: "Easy Run", duration: minutes * 60 });

  it("reaches only the current Training Week and the next", async () => {
    const app = createApp(openDb(":memory:"), () => today, idleRunner());
    expect((await plan(app, "2026-11-02")).week).toBe("2026-11-02");
    expect((await plan(app, "2026-11-09")).week).toBe("2026-11-09");
    expect((await app.request("/api/plan?week=2026-10-26")).status).toBe(404);
    expect((await app.request("/api/plan?week=2026-11-16")).status).toBe(404);
    expect((await app.request("/api/plan?week=2026-11-10")).status).toBe(400);
    expect((await saveDraft(app, "2026-11-16", Array.from({ length: 7 }, () => rest))).status).toBe(404);
  });

  it("saves every edit as the draft, which survives a reload, with the summary to match", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeekShifted(1));
    const app = createApp(db, () => today, idleRunner());
    const { days } = await plan(app, "2026-11-09");
    // Move Wednesday's Quality Run to Thursday, make Tuesday a Long Run and Saturday rest.
    const edited = days.map((d) => d.day);
    [edited[2], edited[3]] = [edited[3]!, edited[2]!];
    edited[1] = { kind: "Long Run", duration: 90 * 60 };
    edited[5] = rest;

    const res = await saveDraft(app, "2026-11-09", edited);

    expect(res.status).toBe(200);
    const saved = (await res.json()) as PlanResponse;
    expect(saved.days.map((d) => d.day)).toEqual(edited);
    // 42:00 + 90 + 47 + 48:30 + 47:00 = 274:30, Reps 65:00: 24%.
    expect(saved.summary).toMatchObject({ plannedTime: 274 * 60 + 30, plannedQualityShare: 24 });
    expect((await plan(createApp(db, () => today, idleRunner()), "2026-11-09")).days.map((d) => d.day)).toEqual(edited);
  });

  it("shows past days of the current week read-only and rejects edits to them", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeekShifted(1));
    const app = createApp(db, () => today, idleRunner());
    const current = await plan(app, "2026-11-02");
    expect(current.days.map((d) => d.editable)).toEqual([false, false, true, true, true, true, true]);

    const edited = current.days.map((d) => d.day);
    edited[1] = easy(30);
    expect((await saveDraft(app, "2026-11-02", edited)).status).toBe(409);
    expect((await plan(app, "2026-11-02")).days[1]!.day).toEqual(current.days[1]!.day);
  });

  it("keeps today editable until an Activity is Matched to it", async () => {
    const db = openDb(":memory:");
    const events = nsmWeekShifted(1);
    sync(db, events);
    const app = createApp(db, () => today, idleRunner());
    expect((await plan(app, "2026-11-02")).days[2]!.editable).toBe(true);

    const run: IntervalsActivity = {
      id: "i1",
      start_date_local: "2026-11-04T07:00:00",
      type: "Run",
      name: "Everett Running",
      moving_time: 2900,
      distance: 9000,
      paired_event_id: null,
    };
    sync(db, events, [run]);
    const matched = await plan(app, "2026-11-02");
    expect(matched.days[2]!.editable).toBe(false);
    const edited = matched.days.map((d) => d.day);
    edited[2] = easy(30);
    expect((await saveDraft(app, "2026-11-02", edited)).status).toBe(409);
  });

  it("rejects a draft that is not seven Week Plan days", async () => {
    const app = createApp(openDb(":memory:"), () => today, idleRunner());
    const days = Array.from({ length: 7 }, () => rest);
    expect((await saveDraft(app, "2026-11-09", days.slice(1))).status).toBe(400);
    expect((await saveDraft(app, "2026-11-09", [{ kind: "Easy Run", duration: -1 } as WeekPlanDay, ...days.slice(1)])).status).toBe(400);
    expect((await saveDraft(app, "2026-11-09", [{ kind: "Tempo" } as unknown as WeekPlanDay, ...days.slice(1)])).status).toBe(400);
    const zeroReps = { kind: "Quality Run", reps: 0, repLength: 180, recovery: 60, warmUp: 600, coolDown: 600 } as const;
    expect((await saveDraft(app, "2026-11-09", [zeroReps, ...days.slice(1)])).status).toBe(400);
  });

  it("saves a Quality Run's Rep Pace Target with the draft, and clears it", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeekShifted(1));
    const app = createApp(db, () => today, idleRunner());
    const edited = (await plan(app, "2026-11-09")).days.map((d) => d.day);
    edited[0] = { ...(edited[0] as Extract<WeekPlanDay, { kind: "Quality Run" }>), repPaceTarget: 420 };

    await saveDraft(app, "2026-11-09", edited);
    expect((await plan(app, "2026-11-09")).days[0]!.day).toMatchObject({ repPaceTarget: 420 });

    edited[0] = { ...edited[0], repPaceTarget: null } as unknown as WeekPlanDay;
    await saveDraft(app, "2026-11-09", edited);
    expect((await plan(app, "2026-11-09")).days[0]!.day).not.toHaveProperty("repPaceTarget");
  });

  it("gives the Rep Pace Target last given per Rep Length, from the calendar and Week Plans alike", async () => {
    const db = openDb(":memory:");
    const quality = { kind: "Quality Run", reps: 3, repLength: 600, recovery: 60, warmUp: 600, coolDown: 600 } as const;
    const pushed = workoutEvent("2026-10-28", { ...quality, repPaceTarget: 430 }, { lthr: 181, easyHrTarget: { low: 62, high: 70 } });
    sync(db, [...nsmWeek, { id: 99, paired_activity_id: null, ...pushed }]);
    const app = createApp(db, () => today, idleRunner());
    expect((await plan(app, "2026-11-09")).repPaceTargets).toEqual({ 600: 430 });

    const edited = (await plan(app, "2026-11-09")).days.map((d) => d.day);
    edited[2] = { ...quality, reps: 2, repPaceTarget: 425 };
    await saveDraft(app, "2026-11-09", edited);
    expect((await plan(app, "2026-11-09")).repPaceTargets).toEqual({ 600: 425 });
  });

  it("rejects a Rep Pace Target that is not whole seconds per mile of at least a minute", async () => {
    const app = createApp(openDb(":memory:"), () => today, idleRunner());
    const days = Array.from({ length: 6 }, () => rest);
    const quality = { kind: "Quality Run", reps: 3, repLength: 600, recovery: 60, warmUp: 600, coolDown: 600 } as const;
    for (const repPaceTarget of [7.5, 30, "7:00"]) {
      const day = { ...quality, repPaceTarget } as unknown as WeekPlanDay;
      expect((await saveDraft(app, "2026-11-09", [day, ...days])).status).toBe(400);
    }
  });

  it("starts a new week as a copy of the previous Week Plan when there is one", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const app = createApp(db, () => today, idleRunner());
    const current = await plan(app, "2026-11-02");
    const edited = current.days.map((d) => d.day);
    edited[6] = easy(25);
    await saveDraft(app, "2026-11-02", edited);

    expect((await plan(app, "2026-11-09")).days.map((d) => d.day)).toEqual(edited);
  });

  it("discards the draft back to a fresh start when nothing was pushed", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeekShifted(1));
    const app = createApp(db, () => today, idleRunner());
    const fresh = await plan(app, "2026-11-09");
    await saveDraft(app, "2026-11-09", Array.from({ length: 7 }, () => rest));

    const res = await app.request("/api/plan/2026-11-09/discard", { method: "POST" });

    expect(res.status).toBe(200);
    expect(((await res.json()) as PlanResponse).days).toEqual(fresh.days);
    expect((await plan(app, "2026-11-09")).days).toEqual(fresh.days);
  });
});

async function saveSettings(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/api/planner-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("planner settings", () => {
  const today = "2026-11-01";

  it("default to the current Easy HR Target and a 25% Quality Share Target, with LTHR and Max HR from intervals.icu", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    const res = await createApp(db, () => today, idleRunner()).request("/api/planner-settings");
    expect(await res.json()).toEqual<PlannerSettingsResponse>({
      easyHrTarget: { low: 62, high: 70 },
      qualityShareTarget: 25,
      lthr: 181,
      maxHr: 197,
    });
  });

  it("have no Easy HR Target, LTHR or Max HR before any is synced", async () => {
    const res = await createApp(openDb(":memory:"), () => today, idleRunner()).request("/api/planner-settings");
    expect(await res.json()).toEqual<PlannerSettingsResponse>({ easyHrTarget: null, qualityShareTarget: 25, lthr: null, maxHr: null });
  });

  it("save the Easy HR Target and Quality Share Target, which persist", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const app = createApp(db, () => today, idleRunner());
    const res = await saveSettings(app, { easyHrTarget: { low: 60, high: 68 }, qualityShareTarget: 20 });
    expect(res.status).toBe(200);
    const reloaded = await createApp(db, () => today, idleRunner()).request("/api/planner-settings");
    expect(await reloaded.json()).toMatchObject({ easyHrTarget: { low: 60, high: 68 }, qualityShareTarget: 20 });
  });

  it("reject an Easy HR Target or Quality Share Target that is not whole percentages, low below high", async () => {
    const app = createApp(openDb(":memory:"), () => today, idleRunner());
    for (const body of [
      { easyHrTarget: { low: 70, high: 62 }, qualityShareTarget: 25 },
      { easyHrTarget: { low: 62, high: 170 }, qualityShareTarget: 25 },
      { easyHrTarget: { low: 62.5, high: 70 }, qualityShareTarget: 25 },
      { easyHrTarget: { low: 62, high: 70 }, qualityShareTarget: 101 },
      { easyHrTarget: { low: 62, high: 70 }, qualityShareTarget: "25" },
    ]) {
      expect((await saveSettings(app, body)).status).toBe(400);
    }
  });

  it("save the Quality Share Target alone, leaving the Easy HR Target following the current one", async () => {
    const db = openDb(":memory:");
    const app = createApp(db, () => today, idleRunner());
    expect((await saveSettings(app, { qualityShareTarget: 22 })).status).toBe(200);
    sync(db, nsmWeek);
    expect(await (await app.request("/api/planner-settings")).json()).toMatchObject({ easyHrTarget: { low: 62, high: 70 }, qualityShareTarget: 22 });

    await saveSettings(app, { easyHrTarget: { low: 60, high: 68 }, qualityShareTarget: 22 });
    await saveSettings(app, { qualityShareTarget: 24 });
    expect(await (await app.request("/api/planner-settings")).json()).toMatchObject({ easyHrTarget: { low: 60, high: 68 } });
    await saveSettings(app, { easyHrTarget: null, qualityShareTarget: 24 });
    expect(await (await app.request("/api/planner-settings")).json()).toMatchObject({ easyHrTarget: { low: 62, high: 70 } });
  });

  it("show LTHR and Max HR as the latest sync read them", async () => {
    const db = openDb(":memory:");
    const app = createApp(db, () => today, idleRunner());
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 198, lthr: 183 });
    expect(await (await app.request("/api/planner-settings")).json()).toMatchObject({ lthr: 183, maxHr: 198 });
  });

  it("give the Week Plan summary its Quality Share Target", async () => {
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    const app = createApp(db, () => today, idleRunner());
    expect((await plan(app)).summary).toMatchObject({ plannedQualityShare: 21, qualityShareTarget: 25 });
    await saveSettings(app, { easyHrTarget: { low: 62, high: 70 }, qualityShareTarget: 22 });
    expect((await plan(app)).summary.qualityShareTarget).toBe(22);
  });
});

type PushRequest = { days: DatedDay[]; targets: WorkoutTargets; replaceNsmApp: boolean };

/**
 * A plan destination that records each push and gives each workout day an event id. It asks to confirm replacing
 * `nsmAppWorkouts` until told to, and fails at the date `failAt` returns, after pushing the days before it.
 */
function fakeDestination({ nsmAppWorkouts = [] as NsmAppWorkout[], failAt = (_date: string): boolean => false } = {}) {
  const pushes: PushRequest[] = [];
  let nextId = 1;
  const destination: PlanDestination = {
    push: async (request): Promise<PlanDestinationResult> => {
      pushes.push(request);
      if (nsmAppWorkouts.length > 0 && !request.replaceNsmApp) return { outcome: "ConfirmReplace", nsmAppWorkouts };
      const days = [];
      for (const { date, day } of request.days) {
        if (failAt(date)) return { outcome: "Failed", days, error: `intervals.icu create ${date} failed: 500` };
        const id = day.kind === "Rest" ? null : String(nextId++);
        days.push({ date, eventId: id, version: id && `v${id}` });
      }
      return { outcome: "Pushed", days, replaced: request.replaceNsmApp ? nsmAppWorkouts : [] };
    },
  };
  return { destination, pushes };
}

async function push(app: ReturnType<typeof createApp>, week: string, body: object = {}) {
  const res = await app.request(`/api/plan/${week}/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as PushResponse };
}

describe("pushing a Week Plan", () => {
  // Wednesday 4 Nov 2026, in a week the app planned from the start: no NSM-app workouts in it.
  const today = "2026-11-04";
  const easy = (minutes: number): WeekPlanDay => ({ kind: "Easy Run", duration: minutes * 60 });

  function setUp(fake = fakeDestination(), activities: IntervalsActivity[] = []) {
    const db = openDb(":memory:");
    sync(db, nsmWeek, activities);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    return { db, app: createApp(db, () => today, idleRunner(), undefined, undefined, fake.destination), ...fake };
  }

  it("sends the remaining days only, with LTHR and the Easy HR Target, and the week is Pushed", async () => {
    const { app, pushes } = setUp();
    const draft = await plan(app, "2026-11-02");

    const { status, body } = await push(app, "2026-11-02");

    expect(status).toBe(200);
    expect(pushes).toEqual([
      {
        days: draft.days.slice(2).map(({ date, day }) => ({ date, day })),
        targets: { lthr: 181, easyHrTarget: { low: 62, high: 70 } },
        replaceNsmApp: false,
      },
    ]);
    expect(body).toMatchObject({ outcome: "Pushed", plan: { status: "Pushed" } });
    expect((await plan(app, "2026-11-02")).pushedAt).not.toBeNull();
  });

  it("moves Draft → Pushed → Unpushed changes → Pushed, sending the edit", async () => {
    const { app, pushes } = setUp();
    const draft = await plan(app, "2026-11-09");
    expect(draft.status).toBe("Draft");
    await push(app, "2026-11-09");
    expect((await plan(app, "2026-11-09")).status).toBe("Pushed");

    const edited = draft.days.map((d) => d.day);
    edited[6] = easy(30);
    const saved = (await (await saveDraft(app, "2026-11-09", edited)).json()) as PlanResponse;
    expect(saved.status).toBe("Unpushed changes");

    const { body } = await push(app, "2026-11-09");
    expect(body).toMatchObject({ outcome: "Pushed", plan: { status: "Pushed" } });
    expect(pushes[1]!.days.at(-1)).toEqual({ date: "2026-11-15", day: easy(30) });
  });

  it("counts a change to a Rep Pace Target alone as Unpushed changes, and sends it", async () => {
    const { app, pushes } = setUp();
    const quality = { kind: "Quality Run", reps: 3, repLength: 600, recovery: 60, warmUp: 600, coolDown: 600 } as const;
    const edited = (await plan(app, "2026-11-09")).days.map((d) => d.day);
    edited[0] = { ...quality, repPaceTarget: 425 };
    await saveDraft(app, "2026-11-09", edited);
    await push(app, "2026-11-09");

    edited[0] = { ...quality, repPaceTarget: 420 };
    const saved = (await (await saveDraft(app, "2026-11-09", edited)).json()) as PlanResponse;
    expect(saved.status).toBe("Unpushed changes");

    await push(app, "2026-11-09");
    expect(pushes[1]!.days[0]).toEqual({ date: "2026-11-09", day: edited[0] });
    expect((await plan(app, "2026-11-09")).status).toBe("Pushed");
  });

  it("never pushes today once an Activity is Matched to it", async () => {
    const run: IntervalsActivity = {
      id: "i1",
      start_date_local: "2026-11-04T07:00:00",
      type: "Run",
      name: "Everett Running",
      moving_time: 2900,
      distance: 9000,
      paired_event_id: null,
    };
    const { db, app, pushes } = setUp();
    sync(db, [...nsmWeek, ...nsmWeekShifted(1).map((e) => ({ ...e, external_id: "nsmpv-" + e.start_date_local.slice(0, 10) }))], [run]);
    await push(app, "2026-11-02");
    expect(pushes[0]!.days.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("stops at a destination error and returns its message; pushing again completes the week", async () => {
    let failing = true;
    const fake = fakeDestination({ failAt: (date) => failing && date === "2026-11-11" });
    const { app, pushes } = setUp(fake);
    await plan(app, "2026-11-09");

    const failed = await push(app, "2026-11-09");
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ outcome: "Failed", error: "intervals.icu create 2026-11-11 failed: 500" });
    expect((await plan(app, "2026-11-09")).status).toBe("Unpushed changes");

    failing = false;
    const retried = await push(app, "2026-11-09");
    expect(retried.body).toMatchObject({ outcome: "Pushed", plan: { status: "Pushed" } });
    expect(pushes).toHaveLength(2);
  });

  it("refuses to push without an Easy HR Target, without asking the destination", async () => {
    const { destination, pushes } = fakeDestination();
    const app = createApp(openDb(":memory:"), () => today, idleRunner(), undefined, undefined, destination);
    await plan(app, "2026-11-09");
    expect((await push(app, "2026-11-09")).status).toBe(409);
    expect(pushes).toEqual([]);
  });
});

describe("replacing NSM-app workouts on the first push", () => {
  // Wednesday 4 Nov 2026, the switchover week: the NSM app planned all of it.
  const today = "2026-11-04";
  const nsmApp = nsmWeekShifted(1);
  const remaining = nsmApp
    .filter((e) => e.start_date_local >= "2026-11-04")
    .map((e) => ({ id: String(e.id), date: e.start_date_local.slice(0, 10), name: e.name }));

  function setUp() {
    const fake = fakeDestination({ nsmAppWorkouts: remaining });
    const db = openDb(":memory:");
    sync(db, nsmApp);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    return { app: createApp(db, () => today, idleRunner(), undefined, undefined, fake.destination), ...fake };
  }

  it("returns the NSM-app workouts on the remaining days for confirmation instead of pushing", async () => {
    const { app } = setUp();
    const { status, body } = await push(app, "2026-11-02");
    expect(status).toBe(200);
    expect(body).toEqual<PushResponse>({ outcome: "ConfirmReplace", nsmAppWorkouts: remaining });
    expect(remaining.map((w) => w.date)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("on confirming, replaces them and pushes the remaining days only, so past days keep the NSM app's", async () => {
    const { app, pushes } = setUp();
    await push(app, "2026-11-02");
    const { body } = await push(app, "2026-11-02", { replaceNsmApp: true });
    expect(body).toMatchObject({ outcome: "Pushed", plan: { status: "Pushed" } });
    expect(pushes[1]).toMatchObject({ replaceNsmApp: true });
    expect(pushes[1]!.days.map((d) => d.date)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("on cancelling, nothing has changed in the Week Plan", async () => {
    const { app } = setUp();
    const before = await plan(app, "2026-11-02");
    await push(app, "2026-11-02");
    const after = await plan(app, "2026-11-02");
    expect(after).toEqual(before);
    expect(after.status).toBe("Draft");
  });

  it("does not ask for a week without NSM-app workouts", async () => {
    const fake = fakeDestination();
    const db = openDb(":memory:");
    sync(db, nsmApp);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    const app = createApp(db, () => today, idleRunner(), undefined, undefined, fake.destination);
    expect((await push(app, "2026-11-09")).body).toMatchObject({ outcome: "Pushed" });
  });
});

describe("discarding after a push that stopped part way", () => {
  it("resets pushed days to what was pushed and the rest to a fresh start", async () => {
    const fake = fakeDestination({ failAt: (date) => date === "2026-11-11" });
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    const app = createApp(db, () => "2026-11-04", idleRunner(), undefined, undefined, fake.destination);
    const fresh = await plan(app, "2026-11-09");
    await push(app, "2026-11-09");
    await saveDraft(app, "2026-11-09", Array.from({ length: 7 }, () => rest));

    const res = await app.request("/api/plan/2026-11-09/discard", { method: "POST" });

    expect(((await res.json()) as PlanResponse).days).toEqual(fresh.days);
  });
});

describe("a Week Plan Changed on intervals.icu", () => {
  const today = "2026-11-04";

  /** Next week pushed, then a sync that found Tuesday's pushed workout edited on intervals.icu. */
  async function changedWeek() {
    const fake = fakeDestination();
    const db = openDb(":memory:");
    sync(db, nsmWeek);
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    const app = createApp(db, () => today, idleRunner(), undefined, undefined, fake.destination);
    const pushed = await plan(app, "2026-11-09");
    await push(app, "2026-11-09");
    const stored = loadWeekPlan(db, "2026-11-09")!;
    saveWeekPlan(db, { ...stored, changedOnIntervals: true });
    return { app, db, pushed, ...fake };
  }

  it("shows the status", async () => {
    const { app } = await changedWeek();
    expect((await plan(app, "2026-11-09")).status).toBe("Changed on intervals.icu");
  });

  it("warns before a push overwrites the change, then restores the Week Plan's version once acknowledged", async () => {
    const { app, pushes, pushed } = await changedWeek();

    const warned = await push(app, "2026-11-09");
    expect(warned.body).toEqual<PushResponse>({ outcome: "ConfirmOverwrite" });
    expect(pushes).toHaveLength(1);

    const restored = await push(app, "2026-11-09", { overwrite: true });
    expect(restored.body).toMatchObject({ outcome: "Pushed", plan: { status: "Pushed" } });
    expect(pushes[1]!.days.map((d) => d.day)).toEqual(pushed.days.map((d) => d.day));
  });

  it("discards the draft back to the last pushed version", async () => {
    const { app, pushed } = await changedWeek();
    await saveDraft(app, "2026-11-09", Array.from({ length: 7 }, () => rest));
    const res = await app.request("/api/plan/2026-11-09/discard", { method: "POST" });
    expect(((await res.json()) as PlanResponse).days).toEqual(pushed.days);
  });
});

describe("Plan Suggestions", () => {
  // Sunday 1 Nov 2026, planning Monday 2 Nov.
  const today = "2026-11-01";

  /**
   * The recorded NSM week, after two earlier 4 × 6:00 Quality Runs, with 4 × 6:00 run on 14, 21 and 28 Oct: Over Target
   * (180 bpm against a 177 bpm top) on the 14th and the 28th.
   */
  function dbWithQualityRuns(runDates = ["2026-10-14", "2026-10-21", "2026-10-28"]) {
    const db = openDb(":memory:");
    const fourBySix = nsmWeek.find((e) => e.name.startsWith("4 x 6:00"))!;
    const earlier = (id: number, date: string): IntervalsEvent => ({
      ...fourBySix,
      id,
      start_date_local: `${date}T12:00:00`,
      external_id: `nsm-${date}`,
      paired_activity_id: null,
    });
    const run = (date: string): IntervalsActivity => ({
      id: `a-${date}`,
      start_date_local: `${date}T07:00:00`,
      type: "Run",
      name: "Everett Running",
      moving_time: 3000,
      distance: 9000,
      paired_event_id: null,
    });
    const reps = (hr: number) => ({
      icu_intervals: Array.from({ length: 4 }, () => ({ type: "WORK", moving_time: 360, gap: 3.2, average_heartrate: hr })),
    });
    saveSync(
      db,
      { from: "2026-10-01", to: "2026-11-30" },
      [
        earlier(1, "2026-10-07"),
        earlier(2, "2026-10-14"),
        earlier(3, "2026-10-21"),
        ...nsmWeek.map((e) => ({ ...e, paired_activity_id: null })),
      ],
      runDates.map(run),
      new Map(runDates.map((date, i) => [`a-${date}`, reps(i % 2 === 0 ? 180 : 166)])),
      { finishedAt: "2026-11-01T12:00:00.000Z", syncedThrough: today },
    );
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 181 });
    return db;
  }

  it("leaves Missed Quality Runs out of the 3 a pull back reads", async () => {
    // 28 Oct was Missed; the last 3 Matched are 7 Oct (Over Target), 14 Oct and 21 Oct (Over Target).
    const app = createApp(dbWithQualityRuns(["2026-10-07", "2026-10-14", "2026-10-21"]), () => today, idleRunner());
    const pull = (await plan(app)).suggestions.find((s) => s.kind === "Pull back")!;
    expect(pull.runs.map((r) => r.date)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
  });

  const suggestionAction = (app: ReturnType<typeof createApp>, week: string, id: string, action: "accept" | "dismiss") =>
    app.request(`/api/plan/${week}/suggestions/${encodeURIComponent(id)}/${action}`, { method: "POST" });

  it("proposes pulling back a Quality Run, with the runs behind it, and accepting it edits the draft", async () => {
    const app = createApp(dbWithQualityRuns(), () => today, idleRunner());
    const before = await plan(app);
    const pull = before.suggestions.find((s) => s.kind === "Pull back")!;
    expect(pull).toMatchObject({ id: "pull-back:2026-11-04:360", date: "2026-11-04", proposal: { day: { reps: 3, repLength: 360 } } });
    expect(pull.runs.map((r) => [r.date, r.flags])).toEqual([
      ["2026-10-14", ["Over Target"]],
      ["2026-10-21", []],
      ["2026-10-28", ["Over Target"]],
    ]);

    const res = await suggestionAction(app, "2026-11-02", pull.id, "accept");

    expect(res.status).toBe(200);
    const accepted = (await res.json()) as PlanResponse;
    expect(accepted.days[2]!.day).toMatchObject({ kind: "Quality Run", reps: 3, repLength: 360 });
    expect(accepted.suggestions.some((s) => s.kind === "Pull back")).toBe(false);
    expect((await plan(app)).days[2]!.day).toMatchObject({ reps: 3 });
  });

  it("dismissing a suggestion hides it for that week, across reloads, and leaves the draft as it was", async () => {
    const db = dbWithQualityRuns();
    const app = createApp(db, () => today, idleRunner());
    const before = await plan(app);

    expect((await suggestionAction(app, "2026-11-02", "pull-back:2026-11-04:360", "dismiss")).status).toBe(200);

    const after = await plan(createApp(db, () => today, idleRunner()));
    expect(after.suggestions.map((s) => s.id)).not.toContain("pull-back:2026-11-04:360");
    expect(after.days).toEqual(before.days);
  });

  it("dismisses for one Training Week only", async () => {
    // Both weeks plan the recorded week's 21% against the 25% target.
    const app = createApp(dbWithQualityRuns(), () => today, idleRunner());
    expect((await plan(app, "2026-10-26")).suggestions.map((s) => s.id)).toContain("quality-share");
    await suggestionAction(app, "2026-11-02", "quality-share", "dismiss");
    expect((await plan(app, "2026-11-02")).suggestions.map((s) => s.id)).not.toContain("quality-share");
    expect((await plan(app, "2026-10-26")).suggestions.map((s) => s.id)).toContain("quality-share");
  });

  it("notes an LTHR changed since the previous week's Planned Workouts", async () => {
    const db = dbWithQualityRuns();
    const app = createApp(db, () => today, idleRunner());
    expect((await plan(app)).suggestions.map((s) => s.id)).not.toContain("lthr-change");
    saveAthleteSettings(db, { runThresholdPace: null, maxHr: 197, lthr: 184 });
    expect((await plan(app)).suggestions.find((s) => s.id === "lthr-change")!.message).toBe("Targets now use LTHR 184 (was 181).");
  });

  it("rejects accepting or dismissing a suggestion that is not showing", async () => {
    const app = createApp(dbWithQualityRuns(), () => today, idleRunner());
    expect((await suggestionAction(app, "2026-11-02", "easy-discipline", "accept")).status).toBe(404);
    expect((await suggestionAction(app, "2026-11-02", "easy-discipline", "dismiss")).status).toBe(404);
    expect((await suggestionAction(app, "2026-11-02", "quality-share", "accept")).status).toBe(409);
  });

  it("warns of a volume step against the finished weeks' actual time", async () => {
    // Three finished weeks, two with one 50:00 run each, against 314:30 planned.
    const app = createApp(dbWithQualityRuns(), () => today, idleRunner());
    expect((await plan(app)).suggestions.find((s) => s.id === "volume-step")!.message).toBe(
      "5:15 planned is 844% above the 0:33 you averaged over the last 3 weeks.",
    );
  });

  it("never blocks a push", async () => {
    const fake = fakeDestination();
    const app = createApp(dbWithQualityRuns(), () => today, idleRunner(), undefined, undefined, fake.destination);
    expect((await plan(app)).suggestions.length).toBeGreaterThan(0);
    expect((await push(app, "2026-11-02")).body).toMatchObject({ outcome: "Pushed" });
  });
});
