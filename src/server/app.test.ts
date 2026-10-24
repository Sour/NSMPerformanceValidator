import { describe, expect, it } from "vitest";
import {
  createApp,
  type EasyResponse,
  type ProgressResponse,
  type SyncStatusResponse,
  type ThresholdsResponse,
  type VolumeResponse,
  type WeekResponse,
} from "./app";
import { openDb } from "./db";
import { saveRunThresholdPace, saveSync } from "./store";
import type { SyncRunner } from "./syncRunner";

describe("/api/sync", () => {
  it("reports that no sync has finished yet", async () => {
    const app = createApp(openDb(":memory:"), () => "2026-10-23", idleRunner());
    const res = await app.request("/api/sync");
    expect(await res.json()).toEqual<SyncStatusResponse>({
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastError: null,
      running: false,
    });
  });

  it("POST runs a sync and responds with its outcome once it has finished", async () => {
    const db = openDb(":memory:");
    const runner = idleRunner(() =>
      saveSync(db, { from: "2026-10-01", to: "2026-10-30" }, [], [], new Map(), {
        finishedAt: "2026-10-23T12:00:00.000Z",
        syncedThrough: "2026-10-23",
      }),
    );
    const app = createApp(db, () => "2026-10-23", runner);

    const res = await app.request("/api/sync", { method: "POST" });

    expect(await res.json()).toEqual<SyncStatusResponse>({
      lastFinishedAt: "2026-10-23T12:00:00.000Z",
      lastSucceededAt: "2026-10-23T12:00:00.000Z",
      lastError: null,
      running: false,
    });
  });
});

describe("Quality Runs", () => {
  /** A 4 x 6:00 Quality Run on 21 Oct 2026 Matched to an Activity with `reps` Reps of 6:00. */
  function dbWithQualityRun(reps: number) {
    const db = openDb(":memory:");
    const event = {
      id: 1,
      start_date_local: "2026-10-21T00:00:00",
      category: "WORKOUT",
      type: "Run",
      name: "4 x 6:00 at 163–177 bpm",
      description: "[NSM]",
      paired_activity_id: "i1",
      workout_doc: {
        steps: [{ reps: 4, steps: [{ duration: 360, intensity: "active" }, { duration: 90, intensity: "recovery" }] }],
      },
    };
    const activity = {
      id: "i1",
      start_date_local: "2026-10-21T07:00:00",
      type: "Run",
      name: "Everett Running",
      moving_time: 3600,
      distance: 10000,
      paired_event_id: 1,
    };
    const icu_intervals = Array.from({ length: reps }, () => ({
      type: "WORK",
      moving_time: 360,
      gap: 3.2,
      average_heartrate: 166,
    }));
    saveSync(db, { from: "2026-10-01", to: "2026-10-30" }, [event], [activity], new Map([["i1", { icu_intervals }]]), {
      finishedAt: "2026-10-23T12:00:00.000Z",
      syncedThrough: "2026-10-23",
    });
    return db;
  }

  it("/api/week says whether a Matched Quality Run is Complete, without sending raw responses", async () => {
    for (const [reps, completion] of [
      [4, "Complete"],
      [3, "Incomplete"],
    ] as const) {
      const app = createApp(dbWithQualityRun(reps), () => "2026-10-23", idleRunner());
      const week = (await (await app.request("/api/week")).json()) as WeekResponse;
      const workout = week.days.find((d) => d.date === "2026-10-21")!.workouts[0]!;
      expect(workout.completion).toBe(completion);
      expect(workout.activity).not.toHaveProperty("raw");
      expect(workout.activity).not.toHaveProperty("intervals");
    }
  });

  it("/api/progress has a card per Rep Length with Rep GAP and Rep HR", async () => {
    const app = createApp(dbWithQualityRun(4), () => "2026-10-23", idleRunner());
    const progress = (await (await app.request("/api/progress")).json()) as ProgressResponse;
    expect(progress.cards).toHaveLength(1);
    expect(progress.cards[0]).toMatchObject({
      repLength: 360,
      latest: {
        date: "2026-10-21",
        complete: true,
        repsRun: 4,
        repGap: 3.2,
        repHr: 166,
        hrCeiling: 177,
        overTarget: false,
        recovery: 90,
        formatChange: null,
      },
      previous: null,
    });
  });
});

describe("/api/volume", () => {
  it("has Weekly Volume for each Training Week through today's, stacked by Run Type", async () => {
    const db = openDb(":memory:");
    const event = {
      id: 1,
      start_date_local: "2026-10-13T00:00:00",
      category: "WORKOUT",
      type: "Run",
      name: "Easy Run",
      description: "[NSM]",
      paired_activity_id: null,
    };
    const activity = (id: string, date: string, distance: number) => ({
      id,
      start_date_local: `${date}T07:00:00`,
      type: "Run",
      name: "Everett Running",
      moving_time: 2400,
      distance,
      paired_event_id: null,
    });
    saveSync(
      db,
      { from: "2026-10-01", to: "2026-10-30" },
      [event],
      [activity("easy", "2026-10-13", 8000), activity("extra", "2026-10-21", 5000)],
      new Map(),
      { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: "2026-10-23" },
    );
    const app = createApp(db, () => "2026-10-23", idleRunner());

    const { weeks } = (await (await app.request("/api/volume")).json()) as VolumeResponse;

    expect(weeks.map((w) => [w.start, w.byCategory["Easy Run"].distance, w.byCategory["Unplanned Run"].distance])).toEqual([
      ["2026-10-12", 8000, 0],
      ["2026-10-19", 0, 5000],
    ]);
  });
});

describe("/api/easy", () => {
  it("has the Easy GAP and Easy HR intervals.icu recorded for each Matched Easy Run and Long Run", async () => {
    const db = openDb(":memory:");
    const event = (id: number, date: string, name: string) => ({
      id,
      start_date_local: `${date}T00:00:00`,
      category: "WORKOUT",
      type: "Run",
      name,
      description: "[NSM]",
      paired_activity_id: null,
    });
    const activity = (id: string, date: string, recorded: { gap?: number; average_heartrate?: number }) => ({
      id,
      start_date_local: `${date}T07:00:00`,
      type: "Run",
      name: "Everett Running",
      moving_time: 2400,
      distance: 8000,
      paired_event_id: null,
      ...recorded,
    });
    saveSync(
      db,
      { from: "2026-10-01", to: "2026-10-30" },
      [event(1, "2026-10-20", "Easy Run"), event(2, "2026-10-24", "Long Run")],
      [
        activity("easy", "2026-10-20", { gap: 2.36, average_heartrate: 139 }),
        activity("long", "2026-10-24", { gap: 2.2 }),
        activity("extra", "2026-10-22", { gap: 2.0, average_heartrate: 122 }),
      ],
      new Map(),
      { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: "2026-10-24" },
    );
    const app = createApp(db, () => "2026-10-24", idleRunner());

    const { runs } = (await (await app.request("/api/easy")).json()) as EasyResponse;

    expect(runs.map((r) => [r.activityId, r.runType, r.easyGap, r.easyHr])).toEqual([
      ["easy", "Easy Run", 2.36, 139],
      ["long", "Long Run", 2.2, null],
    ]);
  });
});

describe("/api/thresholds", () => {
  /** Two 4 x 6:00 Quality Runs and `easyRuns` Easy Runs in the Training Week of 19 Oct 2026, all on GAP = 0.02 × HR − 0.5. */
  function dbWithRuns(easyRuns: number) {
    const db = openDb(":memory:");
    const event = (id: number, date: string, name: string) => ({
      id,
      start_date_local: `${date}T00:00:00`,
      category: "WORKOUT",
      type: "Run",
      name,
      description: "[NSM]",
      paired_activity_id: null,
    });
    const activity = (id: string, date: string, recorded: { gap?: number; average_heartrate?: number } = {}) => ({
      id,
      start_date_local: `${date}T07:00:00`,
      type: "Run",
      name: "Everett Running",
      moving_time: 3600,
      distance: 10000,
      paired_event_id: null,
      ...recorded,
    });
    const reps = (gap: number, average_heartrate: number) => ({
      icu_intervals: Array.from({ length: 4 }, () => ({ type: "WORK", moving_time: 360, gap, average_heartrate })),
    });
    const easy = [
      { date: "2026-10-19", gap: 2.3, average_heartrate: 140 },
      { date: "2026-10-21", gap: 2.4, average_heartrate: 145 },
    ].slice(0, easyRuns);
    saveSync(
      db,
      { from: "2026-10-01", to: "2026-10-30" },
      [
        event(1, "2026-10-20", "4 x 6:00 at 163–177 bpm"),
        event(2, "2026-10-22", "4 x 6:00 at 163–177 bpm"),
        ...easy.map((e, i) => event(10 + i, e.date, "Easy Run")),
      ],
      [
        activity("q1", "2026-10-20"),
        activity("q2", "2026-10-22"),
        ...easy.map((e, i) => activity(`e${i}`, e.date, e)),
      ],
      new Map([
        ["q1", reps(2.8, 165)],
        ["q2", reps(2.9, 170)],
      ]),
      { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: "2026-10-23" },
    );
    return db;
  }

  it("has LTHR from the Quality Run targets and LT2 Pace from the fitted line", async () => {
    const app = createApp(dbWithRuns(2), () => "2026-10-23", idleRunner());
    const thresholds = (await (await app.request("/api/thresholds")).json()) as ThresholdsResponse;
    // LTHR = (163 / 0.90 + 177 / 0.98) / 2 = 180.86; 0.02 × 180.86 − 0.5 = 3.117
    expect(thresholds.lthr).toBeCloseTo(180.86, 2);
    expect(thresholds.lt2Pace).toBeCloseTo(3.117, 3);
  });

  it("has LT1 Pace at an assumed LT1 HR of 88% of LTHR, or at the runner's LT1_HR", async () => {
    const assumed = createApp(dbWithRuns(2), () => "2026-10-23", idleRunner());
    const a = (await (await assumed.request("/api/thresholds")).json()) as ThresholdsResponse;
    // 0.88 × 180.86 = 159.16; 0.02 × 159.16 − 0.5 = 2.683
    expect(a).toMatchObject({ lt1HrAssumed: true });
    expect(a.lt1Hr).toBeCloseTo(159.16, 2);
    expect(a.lt1Pace).toBeCloseTo(2.683, 3);

    const set = createApp(dbWithRuns(2), () => "2026-10-23", idleRunner(), { lt1Hr: 150 });
    const s = (await (await set.request("/api/thresholds")).json()) as ThresholdsResponse;
    expect(s).toMatchObject({ lt1Hr: 150, lt1HrAssumed: false });
    expect(s.lt1Pace).toBeCloseTo(2.5, 10);
  });

  it("has no LT2 Pace, Not enough data, with only one Easy Run", async () => {
    const app = createApp(dbWithRuns(1), () => "2026-10-23", idleRunner());
    const thresholds = (await (await app.request("/api/thresholds")).json()) as ThresholdsResponse;
    expect(thresholds.lthr).toBeCloseTo(180.86, 2);
    expect(thresholds.lt2Pace).toBeNull();
    expect(thresholds.lt1Pace).toBeNull();
  });

  it("has the intervals.icu Threshold Pace beside LT2 Pace, or null when none is stored", async () => {
    const db = dbWithRuns(2);
    const app = createApp(db, () => "2026-10-23", idleRunner());
    const before = (await (await app.request("/api/thresholds")).json()) as ThresholdsResponse;
    expect(before.icuThresholdPace).toBeNull();

    saveRunThresholdPace(db, 3.0);
    const after = (await (await app.request("/api/thresholds")).json()) as ThresholdsResponse;
    expect(after.icuThresholdPace).toBe(3.0);
    expect(after.lt2Pace).toBeCloseTo(3.117, 3);
  });

  it("has the weekly trend from the first Planned Workout's Training Week through this one", async () => {
    const app = createApp(dbWithRuns(2), () => "2026-10-23", idleRunner());
    const { weeks } = (await (await app.request("/api/thresholds")).json()) as ThresholdsResponse;
    expect(weeks.map((w) => w.start)).toEqual(["2026-10-19"]);
    expect(weeks[0]!.lt2Pace).toBeCloseTo(3.117, 3);
  });
});

function idleRunner(sync = () => {}): SyncRunner {
  return { run: async () => sync(), running: false };
}
