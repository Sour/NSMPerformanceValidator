import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp, type FitnessResponse } from "./app";
import { openDb } from "./db";
import type { IntervalsActivity, IntervalsEvent } from "./intervals";
import type { FitnessStart } from "../domain/fitness";
import { saveFitnessStart, saveSync } from "./store";
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
  it("has each day of the last 3 months through today by default, oldest first", async () => {
    const res = await fitness({ events: [qualityRun(1, "2026-03-02", 150)] });
    expect(res.range).toBe("3m");
    expect(res.days).toHaveLength(91);
    expect(res.days[0]!.date).toBe("2026-07-25");
    expect(res.days.at(-1)!.date).toBe("2026-10-23");
  });

  it("has 6 weeks, 6 months or 1 year when asked for, never before stored history starts", async () => {
    const lengths: Record<string, number> = {};
    for (const range of ["6w", "3m", "6m", "1y"]) {
      lengths[range] = (await fitness({ events: [qualityRun(1, "2026-03-02", 150)], range })).days.length;
    }
    // History starts on 2 Mar 2026, 235 days before 23 Oct.
    expect(lengths).toEqual({ "6w": 42, "3m": 91, "6m": 182, "1y": 236 });
  });

  it("rejects an unknown range", async () => {
    const app = createApp(openDb(":memory:"), () => "2026-10-23", idleRunner());
    expect((await app.request("/api/fitness?range=2w")).status).toBe(400);
  });

  it("flags the first 42 days of stored history as settling without a stored starting point", async () => {
    const res = await fitness({ events: [qualityRun(1, "2026-09-01", 150)], activities: [workout("early", "2026-08-30")] });
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

function idleRunner(): SyncRunner {
  return { run: async () => {}, running: false };
}
