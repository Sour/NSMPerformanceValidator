import { describe, expect, it } from "vitest";
import { createApp, type FitnessResponse } from "./app";
import { openDb } from "./db";
import type { IntervalsActivity, IntervalsEvent } from "./intervals";
import { saveAthleteSettings, saveSync } from "./store";
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

function workout(id: string, date: string, type = "Run"): IntervalsActivity {
  return {
    id,
    start_date_local: `${date}T07:00:00`,
    type,
    name: `Everett ${type}`,
    moving_time: 3600,
    distance: type === "Run" ? 10000 : null,
    paired_event_id: null,
  };
}

/** A streams response sampled once a second: each stretch is `seconds` at a heart rate, null for none recorded. */
function streams(...stretches: [seconds: number, hr: number | null][]) {
  const hr = stretches.flatMap(([seconds, bpm]) => Array.from({ length: seconds }, () => bpm));
  return [
    { type: "time", data: hr.map((_, i) => i) },
    { type: "heartrate", data: hr },
  ];
}

interface Seeded {
  events?: IntervalsEvent[];
  activities?: IntervalsActivity[];
  crossTraining?: IntervalsActivity[];
  streamsById?: Map<string, unknown>;
  /** The LTHR of the intervals.icu Run settings. */
  settingsLthr?: number;
  today?: string;
  range?: string;
}

/** The fitness endpoint's response for what was synced, read on `today`. */
async function fitness({
  events = [qualityRun(1, "2026-08-03", 150)],
  activities = [],
  crossTraining = [],
  streamsById = new Map(),
  settingsLthr,
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
  if (settingsLthr !== undefined) saveAthleteSettings(db, { runThresholdPace: null, maxHr: null, lthr: settingsLthr });
  const app = createApp(db, () => today, idleRunner());
  const res = await app.request(range === undefined ? "/api/fitness" : `/api/fitness?range=${range}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FitnessResponse;
}

const day = (response: FitnessResponse, date: string) => response.days.find((d) => d.date === date)!;

describe("/api/fitness Training Load", () => {
  it("is 100 for an hour at LTHR, and scales with the square of heart rate against LTHR below it", async () => {
    const res = await fitness({
      activities: [workout("lthr", "2026-10-20"), workout("easy", "2026-10-21")],
      streamsById: new Map([
        ["lthr", streams([3600, 150])],
        ["easy", streams([3600, 120])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBeCloseTo(100, 6);
    // 120 bpm is 80% of LTHR: 0.8² × 100.
    expect(day(res, "2026-10-21").trainingLoad).toBeCloseTo(64, 6);
    expect(day(res, "2026-10-22").trainingLoad).toBe(0);
  });
});

describe("/api/fitness LTHR", () => {
  it("measures each workout against the LTHR in effect on its day, the earliest one before the first Quality Run", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), qualityRun(2, "2026-10-15", 200)],
      activities: [workout("before", "2026-09-28"), workout("first", "2026-10-14"), workout("second", "2026-10-15")],
      streamsById: new Map([
        ["before", streams([3600, 150])],
        ["first", streams([3600, 150])],
        ["second", streams([3600, 150])],
      ]),
    });
    expect(day(res, "2026-09-28").trainingLoad).toBeCloseTo(100, 6);
    expect(day(res, "2026-10-14").trainingLoad).toBeCloseTo(100, 6);
    // 150 bpm is 75% of the new LTHR of 200: 0.75² × 100.
    expect(day(res, "2026-10-15").trainingLoad).toBeCloseTo(56.25, 6);
  });

  it("does not change an earlier day's Training Load when the current LTHR changes", async () => {
    const run = { activities: [workout("run", "2026-10-05")], streamsById: new Map([["run", streams([3600, 150])]]) };
    const before = await fitness({ ...run, events: [qualityRun(1, "2026-10-01", 150)] });
    const after = await fitness({ ...run, events: [qualityRun(1, "2026-10-01", 150), qualityRun(2, "2026-10-20", 200)] });
    expect(day(after, "2026-10-05").trainingLoad).toBeCloseTo(day(before, "2026-10-05").trainingLoad, 10);
  });

  it("has no days while no Quality Run names a target, whatever the intervals.icu Run settings' LTHR", async () => {
    const res = await fitness({
      events: [easyRun(1, "2026-10-01")],
      activities: [workout("run", "2026-10-05")],
      streamsById: new Map([["run", streams([3600, 150])]]),
      settingsLthr: 150,
    });
    expect(res.days).toEqual([]);
  });
});

describe("/api/fitness Training Load gaps", () => {
  it("adds nothing for samples without heart rate or pauses in recording", async () => {
    // Half an hour at LTHR then half an hour unrecorded; and half an hour at LTHR, a 20-minute pause, and half an hour more.
    const time = [...Array.from({ length: 1800 }, (_, i) => i), ...Array.from({ length: 1800 }, (_, i) => 3000 + i)];
    const paused = [
      { type: "time", data: time },
      { type: "heartrate", data: time.map(() => 150) },
    ];
    const res = await fitness({
      activities: [workout("gappy", "2026-10-20"), workout("paused", "2026-10-21")],
      streamsById: new Map<string, unknown>([
        ["gappy", streams([1800, 150], [1800, null])],
        ["paused", paused],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBeCloseTo(50, 6);
    // The first sample after the pause covers nothing, as it would in moving time.
    expect(day(res, "2026-10-21").trainingLoad).toBeCloseTo((3599 / 3600) * 100, 6);
  });
});

describe("/api/fitness Fitness, Fatigue and Form", () => {
  it("follow 42-day and 7-day exponentially weighted averages from zero at the start of history, decaying on rest days", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150)],
      activities: [workout("run", "2026-10-01")],
      streamsById: new Map([["run", streams([3600, 150])]]),
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
        ["am", streams([3600, 150])],
        ["pm", streams([1800, 150])],
      ]),
    });
    expect(day(res, "2026-10-20").trainingLoad).toBeCloseTo(150, 6);
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

  it("flags the first 42 days of stored history as settling", async () => {
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
        ["partial", streams([600, null], [3600, 150])],
        ["lift", []],
      ]),
    });
    expect(day(res, "2026-10-20")).toMatchObject({ trainingLoad: 0, fitness: 0, fatigue: 0, withoutHeartRate: 2 });
    // The lift has no streams to give; the partial run is not without heart rate.
    expect(day(res, "2026-10-21").withoutHeartRate).toBe(1);
    expect(day(res, "2026-10-21").trainingLoad).toBeCloseTo(100, 6);
    expect(day(res, "2026-10-22").withoutHeartRate).toBe(0);
  });

  it("does not count a workout whose streams are not fetched yet", async () => {
    const res = await fitness({ activities: [workout("pending", "2026-10-20")] });
    expect(day(res, "2026-10-20")).toMatchObject({ trainingLoad: 0, withoutHeartRate: 0 });
  });
});

describe("/api/fitness Cross-Training", () => {
  it("adds Cross-Training's Training Load, against the running LTHR in effect on its day", async () => {
    const res = await fitness({
      events: [qualityRun(1, "2026-10-01", 150), qualityRun(2, "2026-10-15", 200)],
      activities: [workout("run", "2026-10-20")],
      crossTraining: [workout("ride", "2026-10-10", "Ride"), workout("lift", "2026-10-20", "WeightTraining")],
      streamsById: new Map([
        ["run", streams([3600, 150])],
        ["ride", streams([3600, 150])],
        ["lift", streams([1800, 100])],
      ]),
    });
    expect(day(res, "2026-10-10").trainingLoad).toBeCloseTo(100, 6);
    expect(day(res, "2026-10-10").fitness).toBeGreaterThan(0);
    // Against LTHR 200: an hour at 75% is 56.25, half an hour at 50% is 12.5.
    expect(day(res, "2026-10-20").trainingLoad).toBeCloseTo(68.75, 6);
  });
});

function idleRunner(): SyncRunner {
  return { run: async () => {}, running: false };
}
