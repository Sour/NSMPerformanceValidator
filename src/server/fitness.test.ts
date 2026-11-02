import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp, type FitnessResponse } from "./app";
import { openDb } from "./db";
import type { IntervalsActivity, IntervalsEvent } from "./intervals";
import type { EasyHrTarget } from "../domain/easyTrend";
import type { FitnessStart } from "../domain/fitness";
import { saveAthleteSettings, saveFitnessStart, savePlannerSettings, saveSync, type AthleteSettings } from "./store";
import type { SyncRunner } from "./syncRunner";

/** A Quality Run whose 90–98% target gives an LTHR of `lthr`, exactly when it is a multiple of 50. */
function qualityRun(id: number, date: string, lthr: number): IntervalsEvent {
  return {
    id,
    start_date_local: `${date}T00:00:00`,
    category: "WORKOUT",
    type: "Run",
    name: `1 x 10:00 at ${Math.round(lthr * 0.9)}–${Math.round(lthr * 0.98)} bpm`,
    description: "[NSM]",
    paired_activity_id: null,
  };
}

function easyRun(id: number, date: string): IntervalsEvent {
  return { ...qualityRun(id, date, 150), name: "Easy Run" };
}

/** The thresholds intervals.icu recorded with a workout, as in its raw response. */
const RECORDED_THRESHOLDS = { lthr: 150, athlete_max_hr: 200, icu_resting_hr: 50 };

function workout(id: string, date: string, type = "Run", fields: Partial<IntervalsActivity> = {}): IntervalsActivity {
  return {
    id,
    start_date_local: `${date}T07:00:00`,
    type,
    name: `Everett ${type}`,
    moving_time: 3600,
    distance: type === "Run" ? 10000 : null,
    paired_event_id: null,
    ...RECORDED_THRESHOLDS,
    ...fields,
  };
}

/** A run of an hour's moving time whose average GAP is `fraction` of its recorded Threshold Pace. */
function paced(id: string, date: string, fraction: number, fields: Partial<IntervalsActivity> = {}): IntervalsActivity {
  return workout(id, date, "Run", { threshold_pace: 3.3, gap: 3.3 * fraction, ...fields });
}

/**
 * A streams response sampled once a second: each stretch is `seconds` at a heart rate, null for none recorded, and
 * optionally a speed in m/s, which gives the response a speed stream.
 */
function streams(...stretches: [seconds: number, hr: number | null, speed?: number][]) {
  const samples = stretches.flatMap(([seconds, bpm, speed]) => Array.from({ length: seconds }, () => ({ bpm, speed })));
  const response = [
    { type: "time", data: samples.map((_, i) => i) },
    { type: "heartrate", data: samples.map((s) => s.bpm) },
  ];
  if (stretches.some(([, , speed]) => speed !== undefined)) {
    response.push({ type: "velocity_smooth", data: samples.map((s) => s.speed ?? 1.5) });
  }
  return response;
}

/** A recorded intervals.icu activity response, anonymised, and its streams response with speed. */
function recordedWorkout(name: string): { activity: IntervalsActivity; streams: unknown } {
  return JSON.parse(readFileSync(new URL(`./fixtures/intervals/${name}.json`, import.meta.url), "utf8"));
}

interface Seeded {
  events?: IntervalsEvent[];
  activities?: IntervalsActivity[];
  crossTraining?: IntervalsActivity[];
  streamsById?: Map<string, unknown>;
  /** The Fitness and Fatigue stored from intervals.icu as the starting point. */
  start?: FitnessStart;
  /** The intervals.icu Run settings the latest sync read. */
  athlete?: AthleteSettings;
  /** The Easy HR Target set for the planner. */
  easyHrTarget?: EasyHrTarget;
  today?: string;
  range?: string;
}

/** The fitness endpoint's response for what was synced, read on `today`. */
async function fitness({
  events = [qualityRun(1, "2026-08-03", 150)],
  activities = [],
  crossTraining = [],
  streamsById = new Map(),
  start,
  athlete,
  easyHrTarget,
  today = "2026-10-23",
  range,
}: Seeded): Promise<FitnessResponse> {
  const db = openDb(":memory:");
  saveSync(
    db,
    { from: "2026-01-01", to: "2026-12-31" },
    events,
    activities,
    new Map(),
    { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: today },
    streamsById,
    crossTraining,
  );
  if (start !== undefined) saveFitnessStart(db, start);
  if (athlete !== undefined) saveAthleteSettings(db, athlete);
  if (easyHrTarget !== undefined) savePlannerSettings(db, { easyHrTarget, qualityShareTarget: null });
  const app = createApp(db, () => today, idleRunner());
  const res = await app.request(range === undefined ? "/api/fitness" : `/api/fitness?range=${range}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FitnessResponse;
}

const day = (response: FitnessResponse, date: string) => response.days.find((d) => d.date === date)!;

describe("/api/fitness HR Load", () => {
  it("is 100 for an hour at the recorded LTHR, and 0 below the recorded resting HR", async () => {
    const res = await fitness({
      activities: [workout("lthr", "2026-10-20"), workout("resting", "2026-10-21")],
      streamsById: new Map([
        ["lthr", streams([3600, 150])],
        ["resting", streams([3600, 45])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(100);
    expect(day(res, "2026-10-21")).toMatchObject({ trainingLoad: 0, withoutHeartRate: 0 });
    expect(day(res, "2026-10-22").trainingLoad).toBe(0);
  });

  it("weights heart rate by Banister's TRIMP between resting HR and Max HR, rounded to a whole number", async () => {
    const res = await fitness({
      activities: [workout("easy", "2026-10-20"), workout("short", "2026-10-21")],
      streamsById: new Map([
        ["easy", streams([3600, 120])],
        ["short", streams([1201, 150])],
      ]),
    });
    // 120 bpm is 46.7% of the way from resting HR to Max HR, LTHR 66.7%: 0.467·e^(1.92·0.467) ÷ 0.667·e^(1.92·0.667).
    expect(day(res, "2026-10-20").trainingLoad).toBe(48);
    // Twenty minutes at LTHR is 33.3.
    expect(day(res, "2026-10-21").trainingLoad).toBe(33);
  });

  it("scores each workout against the thresholds recorded with it", async () => {
    const res = await fitness({
      activities: [workout("old", "2026-10-05", "Run", { lthr: 175, athlete_max_hr: 197 }), workout("new", "2026-10-06")],
      streamsById: new Map([
        ["old", streams([3600, 150])],
        ["new", streams([3600, 150])],
      ]),
    });
    expect(day(res, "2026-10-05").trainingLoad).toBeLessThan(100);
    expect(day(res, "2026-10-06").trainingLoad).toBe(100);
  });

  it("draws without a Quality Run naming a target", async () => {
    const res = await fitness({
      events: [easyRun(1, "2026-10-01")],
      activities: [workout("run", "2026-10-05")],
      streamsById: new Map([["run", streams([3600, 150])]]),
    });
    expect(day(res, "2026-10-05").trainingLoad).toBe(100);
  });
});

describe("/api/fitness HR Load samples", () => {
  it("adds nothing for samples without heart rate, and counts long gaps between samples in full", async () => {
    const sparse = [
      { type: "time", data: [0, 1800, 3600] },
      { type: "heartrate", data: [150, 150, 150] },
    ];
    const res = await fitness({
      activities: [workout("gappy", "2026-10-20"), workout("sparse", "2026-10-21")],
      streamsById: new Map<string, unknown>([
        ["gappy", streams([1801, 150], [1800, null])],
        ["sparse", sparse],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(50);
    expect(day(res, "2026-10-21").trainingLoad).toBe(100);
  });

  it("leaves out stopped samples when there is a speed stream, and counts every sample without one", async () => {
    const res = await fitness({
      crossTraining: [workout("hike", "2026-10-20", "Hike"), workout("lift", "2026-10-21", "WeightTraining")],
      streamsById: new Map([
        ["hike", streams([1801, 150, 1.2], [1800, 150, 0])],
        ["lift", streams([1801, 150], [1800, 150])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(50);
    expect(day(res, "2026-10-21").trainingLoad).toBe(100);
  });
});

describe("/api/fitness Pace Load", () => {
  it("scores a run by its moving time and GAP against its recorded Threshold Pace first", async () => {
    const res = await fitness({
      activities: [paced("threshold", "2026-10-20", 1), paced("steady", "2026-10-21", 0.9)],
      // Heart rate alone would score both 48.
      streamsById: new Map([
        ["threshold", streams([3600, 120])],
        ["steady", streams([3600, 120])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(100);
    expect(day(res, "2026-10-21").trainingLoad).toBe(81);
  });

  it("falls back to HR Load for a run without a GAP or Threshold Pace", async () => {
    const res = await fitness({
      activities: [
        paced("treadmill", "2026-10-19", 1, { gap: 0 }),
        paced("no-gap", "2026-10-20", 1, { gap: null }),
        paced("no-threshold", "2026-10-21", 1, { threshold_pace: null }),
      ],
      streamsById: new Map([
        ["treadmill", streams([3601, 150])],
        ["no-gap", streams([3601, 150])],
        ["no-threshold", streams([3601, 150])],
      ]),
    });
    expect([19, 20, 21].map((d) => day(res, `2026-10-${d}`).trainingLoad)).toEqual([100, 100, 100]);
  });

  it("scores Cross-Training by HR Load even when its raw response has a GAP", async () => {
    const res = await fitness({
      crossTraining: [workout("walk", "2026-10-20", "Walk", { threshold_pace: 3.3, gap: 3.3 })],
      streamsById: new Map([["walk", streams([1801, 150])]]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(50);
  });
});

describe("/api/fitness Training Load against intervals.icu", () => {
  it("matches intervals.icu's Training Load within its rounding for a recorded run and hike", async () => {
    const run = recordedWorkout("training-load-run");
    const hike = recordedWorkout("training-load-hike");
    const res = await fitness({
      activities: [run.activity],
      crossTraining: [hike.activity],
      streamsById: new Map([
        [run.activity.id, run.streams],
        [hike.activity.id, hike.streams],
      ]),
      today: "2026-11-01",
    });
    expect(Math.abs(day(res, "2026-10-30").trainingLoad - Number(run.activity.icu_training_load))).toBeLessThanOrEqual(1);
    expect(Math.abs(day(res, "2026-10-24").trainingLoad - Number(hike.activity.icu_training_load))).toBeLessThanOrEqual(1);
  });

  it("matches intervals.icu's HR Load for a recorded run scored without its GAP", async () => {
    const run = recordedWorkout("training-load-run");
    const res = await fitness({
      activities: [{ ...run.activity, gap: null }],
      streamsById: new Map([[run.activity.id, run.streams]]),
      today: "2026-11-01",
    });
    expect(Math.abs(day(res, "2026-10-30").trainingLoad - Number(run.activity.hr_load))).toBeLessThanOrEqual(1);
  });
});

describe("/api/fitness Fitness, Fatigue and Form", () => {
  it("follow 42-day and 7-day exponentially weighted averages from zero at the start of history, decaying on rest days", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      activities: [workout("run", "2026-10-01")],
      streamsById: new Map([["run", streams([3601, 150])]]),
    });
    const first = day(res, "2026-10-01");
    expect(first.fitness).toBeCloseTo(100 * (1 - Math.exp(-1 / 42)), 6);
    expect(first.fatigue).toBeCloseTo(100 * (1 - Math.exp(-1 / 7)), 6);
    expect(first.form).toBeCloseTo(first.fitness - first.fatigue, 10);

    const rest = day(res, "2026-10-02");
    expect(rest.trainingLoad).toBe(0);
    expect(rest.fitness).toBeCloseTo(first.fitness * Math.exp(-1 / 42), 6);
    expect(rest.fatigue).toBeCloseTo(first.fatigue * Math.exp(-1 / 7), 6);
    expect(rest.form).toBeCloseTo(rest.fitness - rest.fatigue, 10);
  });

  it("adds up the Training Load of every workout on a day", async () => {
    const res = await fitness({
      activities: [workout("am", "2026-10-20"), workout("pm", "2026-10-20")],
      streamsById: new Map([
        ["am", streams([3601, 150])],
        ["pm", streams([1801, 150])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBe(150);
  });
});

describe("/api/fitness starting point", () => {
  it("starts Fitness and Fatigue from those stored for the day before stored history, with no day settling", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      activities: [workout("run", "2026-10-01")],
      streamsById: new Map([["run", streams([3601, 150])]]),
      start: { date: "2026-09-30", fitness: 28, fatigue: 22 },
    });
    const first = day(res, "2026-10-01");
    expect(first.fitness).toBeCloseTo(28 + (100 - 28) * (1 - Math.exp(-1 / 42)), 6);
    expect(first.fatigue).toBeCloseTo(22 + (100 - 22) * (1 - Math.exp(-1 / 7)), 6);
    expect(res.days.some((d) => d.settling)).toBe(false);
  });

  it("decays from the one stored when it is for an earlier day than the day before stored history", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      start: { date: "2026-09-29", fitness: 28, fatigue: 22 },
    });
    expect(res.days[0]).toMatchObject({ date: "2026-10-01", settling: false });
    expect(res.days[0]!.fitness).toBeCloseTo(28 * Math.exp(-2 / 42), 6);
    expect(res.days[0]!.fatigue).toBeCloseTo(22 * Math.exp(-2 / 7), 6);
  });

  it("starts from zero, settling, when the one stored is for a later day than stored history now starts", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      activities: [workout("run", "2026-10-01")],
      streamsById: new Map([["run", streams([3601, 150])]]),
      start: { date: "2026-10-05", fitness: 28, fatigue: 22 },
    });
    expect(day(res, "2026-10-01").fitness).toBeCloseTo(100 * (1 - Math.exp(-1 / 42)), 6);
    expect(day(res, "2026-10-01").settling).toBe(true);
  });
});

describe("/api/fitness range", () => {
  it("has each of the last 42 days through today by default, oldest first", async () => {
    const res = await fitness({ events: [qualityRun(1, "2026-03-02", 150)] });
    expect(res.range).toBe("6w");
    expect(res.days).toHaveLength(42);
    expect(res.days[0]!.date).toBe("2026-09-12");
    expect(res.days.at(-1)!.date).toBe("2026-10-23");
  });

  it("has 1 month, 42 days, 3 months, 6 months or 1 year when asked for, never before stored history starts", async () => {
    const lengths: Record<string, number> = {};
    for (const range of ["1m", "6w", "3m", "6m", "1y"]) {
      lengths[range] = (await fitness({ events: [qualityRun(1, "2026-03-02", 150)], range })).days.length;
    }
    // History starts on 2 Mar 2026, 235 days before 23 Oct.
    expect(lengths).toEqual({ "1m": 30, "6w": 42, "3m": 91, "6m": 182, "1y": 236 });
  });

  it("rejects an unknown range", async () => {
    const app = createApp(openDb(":memory:"), () => "2026-10-23", idleRunner());
    expect((await app.request("/api/fitness?range=2w")).status).toBe(400);
  });

  it("flags the first 42 days of stored history as settling without a stored starting point", async () => {
    const res = await fitness({ events: [qualityRun(1, "2026-09-01", 150)], activities: [workout("early", "2026-08-30")], range: "3m" });
    expect(res.days[0]!.date).toBe("2026-08-30");
    expect(day(res, "2026-10-10").settling).toBe(true);
    expect(day(res, "2026-10-11").settling).toBe(false);
  });
});

describe("/api/fitness workouts without heart rate", () => {
  it("counts each day's workouts without any heart rate, which add nothing", async () => {
    const res = await fitness({
      activities: [workout("strapless", "2026-10-20"), workout("dropped", "2026-10-20"), workout("partial", "2026-10-21")],
      crossTraining: [workout("lift", "2026-10-21", "WeightTraining")],
      streamsById: new Map<string, unknown>([
        ["strapless", [{ type: "time", data: [0, 1, 2] }]],
        ["dropped", streams([600, 0])],
        ["partial", streams([600, null], [3601, 150])],
        ["lift", []],
      ]),
    });
    expect(day(res, "2026-10-20")).toMatchObject({ trainingLoad: 0, fitness: 0, fatigue: 0, withoutHeartRate: 2 });
    // The lift has no streams to give; the partial run is not without heart rate.
    expect(day(res, "2026-10-21").withoutHeartRate).toBe(1);
    expect(day(res, "2026-10-21").trainingLoad).toBe(100);
    expect(day(res, "2026-10-22").withoutHeartRate).toBe(0);
  });

  it("counts a workout missing a recorded threshold it needs as one without heart rate", async () => {
    const res = await fitness({
      activities: [workout("no-lthr", "2026-10-20", "Run", { lthr: null }), workout("no-resting", "2026-10-20", "Run", { icu_resting_hr: undefined })],
      crossTraining: [workout("no-max", "2026-10-21", "Walk", { athlete_max_hr: 0 })],
      streamsById: new Map([
        ["no-lthr", streams([3600, 150])],
        ["no-resting", streams([3600, 150])],
        ["no-max", streams([3600, 150])],
      ]),
    });
    expect(day(res, "2026-10-20")).toMatchObject({ trainingLoad: 0, withoutHeartRate: 2 });
    expect(day(res, "2026-10-21")).toMatchObject({ trainingLoad: 0, withoutHeartRate: 1 });
  });

  it("does not count a workout whose streams are not fetched yet", async () => {
    const res = await fitness({ activities: [workout("pending", "2026-10-20")] });
    expect(day(res, "2026-10-20")).toMatchObject({ trainingLoad: 0, withoutHeartRate: 0 });
  });
});

describe("/api/fitness Cross-Training", () => {
  it("adds Cross-Training's Training Load, against the thresholds recorded with it rather than the running ones", async () => {
    const other = { lthr: 178, athlete_max_hr: 196, icu_resting_hr: 52 };
    const res = await fitness({
      activities: [workout("run", "2026-10-20")],
      crossTraining: [workout("ride", "2026-10-10", "Ride", other), workout("lift", "2026-10-20", "WeightTraining", other)],
      streamsById: new Map([
        ["run", streams([3601, 150])],
        ["ride", streams([3601, 178])],
        ["lift", streams([1801, 178])],
      ]),
    });
    expect(day(res, "2026-10-10").trainingLoad).toBe(100);
    expect(day(res, "2026-10-10").fitness).toBeGreaterThan(0);
    expect(day(res, "2026-10-20").trainingLoad).toBe(150);
  });
});

describe("/api/fitness WeightTraining", () => {
  it("adds to Fatigue only: Fitness decays as on a rest day", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      crossTraining: [workout("lift", "2026-10-01", "WeightTraining")],
      streamsById: new Map([["lift", streams([3601, 150])]]),
      start: { date: "2026-09-30", fitness: 28, fatigue: 22 },
    });
    const lift = day(res, "2026-10-01");
    expect(lift.trainingLoad).toBe(100);
    expect(lift.fitness).toBeCloseTo(28 * Math.exp(-1 / 42), 6);
    expect(lift.fatigue).toBeCloseTo(22 + (100 - 22) * (1 - Math.exp(-1 / 7)), 6);
  });

  it("moves Fitness toward the Run's load and Fatigue toward both on a day with each", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      activities: [workout("run", "2026-10-01")],
      crossTraining: [workout("lift", "2026-10-01", "WeightTraining")],
      streamsById: new Map([
        ["run", streams([3601, 150])],
        ["lift", streams([1801, 150])],
      ]),
    });
    const both = day(res, "2026-10-01");
    expect(both.trainingLoad).toBe(150);
    expect(both.fitness).toBeCloseTo(100 * (1 - Math.exp(-1 / 42)), 6);
    expect(both.fatigue).toBeCloseTo(150 * (1 - Math.exp(-1 / 7)), 6);
  });

  it("gives intervals.icu's Fitness and Fatigue every day for the runner's workouts from 2026-09-29 to 2026-11-01", async () => {
    const recorded = JSON.parse(readFileSync(new URL("./fixtures/intervals/fitness-2026-09-29.json", import.meta.url), "utf8")) as {
      start: FitnessStart;
      workouts: { date: string; type: string; trainingLoad: number }[];
      wellness: { date: string; ctl: number; atl: number }[];
    };
    // Each workout as an HR Load at LTHR scoring its intervals.icu Training Load.
    const workouts = recorded.workouts.map((w, i) => workout(`w${i}`, w.date, w.type));
    const res = await fitness({
      events: [],
      activities: workouts.filter((w) => w.type === "Run"),
      crossTraining: workouts.filter((w) => w.type !== "Run"),
      streamsById: new Map(recorded.workouts.map((w, i) => [`w${i}`, streams([w.trainingLoad * 36 + 1, 150])])),
      start: recorded.start,
      today: "2026-11-01",
    });
    for (const { date, ctl, atl } of recorded.wellness) {
      expect(Math.abs(day(res, date).fitness - ctl), `Fitness on ${date}`).toBeLessThan(0.05);
      expect(Math.abs(day(res, date).fatigue - atl), `Fatigue on ${date}`).toBeLessThan(0.05);
    }
  });
});

/** An intervals.icu `workout_doc` step `seconds` long with a heart-rate target, or none. */
function step(seconds: number, hr?: [start: number, end: number, units: "%hr" | "%lthr" | "bpm"]) {
  return { duration: seconds, ...(hr && { hr: { start: hr[0], end: hr[1], units: hr[2], target: "1s" } }) };
}

/** A Planned Workout with these `workout_doc` steps; null steps for one without a `workout_doc`. */
function plannedRun(id: number, date: string, steps: object[] | null, fields: Partial<IntervalsEvent> = {}): IntervalsEvent {
  return { ...easyRun(id, date), ...(steps && { workout_doc: { steps } }), ...fields };
}

/** LTHR 150 and Max HR 200 and, with EARLIER_RUN's recorded resting HR of 50, an hour at 150 bpm is 100. */
const ATHLETE: AthleteSettings = { lthr: 150, maxHr: 200, runThresholdPace: null };
/** Recorded with resting HR 50, and without streams, so it adds no Training Load. */
const EARLIER_RUN = workout("earlier", "2026-10-20");

describe("/api/fitness today's Planned Workouts", () => {
  it("adds today's unMatched plan's Planned Training Load to today's load, Fitness and Fatigue", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])])],
      activities: [EARLIER_RUN],
      athlete: ATHLETE,
    });
    const today = day(res, "2026-10-23");
    const yesterday = day(res, "2026-10-22");
    expect(today).toMatchObject({ trainingLoad: 100, plannedTrainingLoad: 100, withoutHeartRate: 0 });
    expect(today.fitness).toBeCloseTo(yesterday.fitness + (100 - yesterday.fitness) * (1 - Math.exp(-1 / 42)), 6);
    expect(today.fatigue).toBeCloseTo(yesterday.fatigue + (100 - yesterday.fatigue) * (1 - Math.exp(-1 / 7)), 6);
    expect(res.days.filter((d) => d.date !== "2026-10-23").every((d) => d.plannedTrainingLoad === 0)).toBe(true);
  });

  it("reads %hr targets of Max HR, %lthr of LTHR and bpm as given, at each target's midpoint", async () => {
    const res = await fitness({
      events: [
        qualityRun(1, "2026-10-01", 150),
        plannedRun(2, "2026-10-23", [step(1200, [70, 80, "%hr"]), step(1200, [90, 110, "%lthr"]), step(1200, [145, 155, "bpm"])]),
      ],
      activities: [EARLIER_RUN],
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-23").plannedTrainingLoad).toBe(100);
  });

  it("counts a repeat group's steps once per repeat, and an untargeted step at the Easy HR Target's midpoint", async () => {
    const res = await fitness({
      events: [
        qualityRun(1, "2026-10-01", 150),
        plannedRun(2, "2026-10-23", [{ reps: 3, steps: [step(600, [150, 150, "bpm"]), step(300)] }]),
      ],
      activities: [EARLIER_RUN],
      athlete: ATHLETE,
      easyHrTarget: { low: 70, high: 80 },
    });
    // 3 × 15 minutes, all at 150 bpm.
    expect(day(res, "2026-10-23").plannedTrainingLoad).toBe(75);
  });

  it("counts a warm-up and cool-down ending on a lap press at their planned duration", async () => {
    const lapPress = (s: object) => ({ ...s, until_lap_press: true });
    const res = await fitness({
      events: [
        qualityRun(1, "2026-10-01", 150),
        plannedRun(2, "2026-10-23", [
          lapPress({ ...step(1800, [140, 160, "bpm"]), warmup: true }),
          lapPress({ ...step(1800, [140, 160, "bpm"]), cooldown: true }),
        ]),
      ],
      activities: [EARLIER_RUN],
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-23").plannedTrainingLoad).toBe(100);
  });

  it("adds nothing for a plan without steps or without thresholds", async () => {
    const todayOf = async (plan: IntervalsEvent, athlete?: AthleteSettings) =>
      day(await fitness({ events: [qualityRun(1, "2026-10-01", 150), plan], activities: [EARLIER_RUN], athlete }), "2026-10-23");
    expect(await todayOf(plannedRun(2, "2026-10-23", null), ATHLETE)).toMatchObject({ trainingLoad: 0, plannedTrainingLoad: 0 });
    expect(await todayOf(plannedRun(2, "2026-10-23", []), ATHLETE)).toMatchObject({ plannedTrainingLoad: 0 });
    expect(await todayOf(plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])]))).toMatchObject({ plannedTrainingLoad: 0 });
    // An untargeted step without an Easy HR Target, set or planned, cannot be estimated.
    expect(await todayOf(plannedRun(2, "2026-10-23", [step(3600)]), ATHLETE)).toMatchObject({ plannedTrainingLoad: 0 });
  });

  it("stops counting a plan once a run is Matched to it", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])])],
      activities: [EARLIER_RUN, workout("done", "2026-10-23")],
      streamsById: new Map([["done", streams([1801, 150])]]),
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-23")).toMatchObject({ trainingLoad: 50, plannedTrainingLoad: 0 });
  });

  it("with two plans today and one Matched, counts only the other", async () => {
    const res = await fitness({
      events: [
        qualityRun(1, "2026-10-01", 150),
        plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])], { paired_activity_id: "am" }),
        plannedRun(3, "2026-10-23", [step(1800, [140, 160, "bpm"])]),
      ],
      activities: [EARLIER_RUN, workout("am", "2026-10-23")],
      streamsById: new Map([["am", streams([3601, 150])]]),
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-23")).toMatchObject({ trainingLoad: 150, plannedTrainingLoad: 50 });
  });

  it("still counts a plan with only Cross-Training on the day", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])])],
      activities: [EARLIER_RUN],
      crossTraining: [workout("ride", "2026-10-23", "Ride")],
      streamsById: new Map([["ride", streams([1801, 150])]]),
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-23")).toMatchObject({ trainingLoad: 150, plannedTrainingLoad: 100 });
  });

  it("adds nothing for a plan from an earlier day that was never done", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), plannedRun(2, "2026-10-22", [step(3600, [140, 160, "bpm"])])],
      activities: [EARLIER_RUN],
      athlete: ATHLETE,
    });
    expect(day(res, "2026-10-22")).toMatchObject({ trainingLoad: 0, plannedTrainingLoad: 0 });
    expect(day(res, "2026-10-23")).toMatchObject({ trainingLoad: 0, plannedTrainingLoad: 0 });
  });

  it("estimates the runner's 2026-11-02 plan near intervals.icu's 37, against today's thresholds", async () => {
    const plan = JSON.parse(readFileSync(new URL("./fixtures/intervals/plan-2026-11-02.json", import.meta.url), "utf8")) as IntervalsEvent;
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), plan],
      // The latest Activity's resting HR is the one used; an earlier one recorded another.
      activities: [
        workout("older", "2026-10-25", "Run", { icu_resting_hr: 48 }),
        workout("latest", "2026-11-01", "Run", { icu_resting_hr: 52 }),
      ],
      athlete: { lthr: 175, maxHr: 197, runThresholdPace: null },
      // Its recoveries count at 66% of Max HR, as its own warm-up and cool-down are run.
      easyHrTarget: { low: 62, high: 70 },
      today: "2026-11-02",
    });
    expect(day(res, "2026-11-02").plannedTrainingLoad).toBe(41);
    expect(Math.abs(day(res, "2026-11-02").plannedTrainingLoad - Number(plan.icu_training_load))).toBeLessThanOrEqual(4);
  });
});

/** A response whose only day, 2026-10-01, has Form `form`, from a stored starting point. */
function withForm(form: number): Promise<FitnessResponse> {
  const start =
    form >= 0
      ? { date: "2026-09-30", fitness: form / Math.exp(-1 / 42), fatigue: 0 }
      : { date: "2026-09-30", fitness: 0, fatigue: -form / Math.exp(-1 / 7) };
  return fitness({ events: [qualityRun(1, "2026-10-01", 150)], start, today: "2026-10-01" });
}

describe("/api/fitness Form Zones", () => {
  it("judges each day's Form, rounded to a whole number, against intervals.icu's zones", async () => {
    const zones: Record<string, string> = {};
    for (const form of [20.6, 20.4, 5.6, 5.4, -9.4, -9.6, -30.4, -30.6]) {
      const res = await withForm(form);
      expect(res.days[0]!.form).toBeCloseTo(form, 6);
      zones[form] = res.days[0]!.formZone;
    }
    expect(zones).toEqual({
      "20.6": "Transition",
      "20.4": "Fresh",
      "5.6": "Fresh",
      "5.4": "Grey Zone",
      "-9.4": "Grey Zone",
      "-9.6": "Optimal",
      "-30.4": "Optimal",
      "-30.6": "High Risk",
    });
  });
});

describe("/api/fitness Form Zone count", () => {
  it("counts the days in each Form Zone over the range, leaving out settling days", async () => {
    const res = await fitness({ events: [qualityRun(1, "2026-09-01", 150)], activities: [workout("early", "2026-08-30")], range: "3m" });
    // History starts on 30 Aug; 11 Oct to 23 Oct have settled, all at Form 0.
    expect(res.formZones).toEqual({
      counted: 13,
      days: { Transition: 0, Fresh: 0, "Grey Zone": 13, Optimal: 0, "High Risk": 0 },
    });
  });

  it("follows the selected range", async () => {
    const counted = async (range: string) => (await fitness({ events: [qualityRun(1, "2026-03-02", 150)], range })).formZones.counted;
    expect([await counted("1m"), await counted("6w")]).toEqual([30, 42]);
  });

  it("leaves out today while it still has an unMatched plan, and counts it once its plan is Matched", async () => {
    const seeded = {
      events: [qualityRun(1, "2026-03-02", 150), plannedRun(2, "2026-10-23", [step(3600, [140, 160, "bpm"])])],
      athlete: ATHLETE,
      start: { date: "2026-03-01", fitness: 0, fatigue: 0 },
    };
    const planned = await fitness({ ...seeded, activities: [EARLIER_RUN] });
    expect(planned.formZones.counted).toBe(41);
    const done = await fitness({
      ...seeded,
      activities: [EARLIER_RUN, workout("done", "2026-10-23")],
      streamsById: new Map([["done", streams([601, 150])]]),
    });
    expect(done.formZones.counted).toBe(42);
  });
});

function idleRunner(): SyncRunner {
  return { run: async () => {}, running: false };
}
