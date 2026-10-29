import { describe, expect, it } from "vitest";
import {
  createApp,
  type EasyResponse,
  type ProgressResponse,
  type RefetchResponse,
  type SyncStatusResponse,
  type ThresholdsResponse,
  type VolumeResponse,
  type WeekResponse,
} from "./app";
import { secondsPerMile } from "../domain/pace";
import { openDb } from "./db";
import { deleteActivity, saveActivity, saveAthleteSettings, saveSync } from "./store";
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
  const activity = {
    id: "i1",
    start_date_local: "2026-10-21T07:00:00",
    type: "Run",
    name: "Everett Running",
    moving_time: 3600,
    distance: 10000,
    paired_event_id: 1,
  };

  /**
   * A 4 x 6:00 Quality Run on 21 Oct 2026 Matched to an Activity with `reps` Reps of 6:00,
   * whose intervals intervals.icu last analysed at `analyzed`.
   */
  function dbWithQualityRun(reps: number, analyzed?: string) {
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
    const icu_intervals = Array.from({ length: reps }, () => ({
      type: "WORK",
      moving_time: 360,
      gap: 3.2,
      average_heartrate: 166,
    }));
    const response = analyzed === undefined ? { icu_intervals } : { analyzed, icu_intervals };
    saveSync(db, { from: "2026-10-01", to: "2026-10-30" }, [event], [activity], new Map([["i1", response]]), {
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
      expect(workout.activity).not.toHaveProperty("streams");
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

  it("/api/week gives the Training Week containing any date, and how far back and forward weeks go", async () => {
    const app = createApp(dbWithQualityRun(4), () => "2026-11-04", idleRunner());

    const past = (await (await app.request("/api/week?date=2026-10-22")).json()) as WeekResponse;
    expect(past).toMatchObject({ today: "2026-11-04", start: "2026-10-19", earliest: "2026-10-19", latest: "2026-11-02" });
    expect(past.days.find((d) => d.date === "2026-10-21")!.workouts[0]).toMatchObject({
      status: "Matched",
      completion: "Complete",
      activity: { id: "i1" },
    });

    const upcoming = (await (await app.request("/api/week?date=2026-11-12")).json()) as WeekResponse;
    expect([upcoming.start, upcoming.end]).toEqual(["2026-11-09", "2026-11-15"]);

    const current = (await (await app.request("/api/week")).json()) as WeekResponse;
    expect(current.start).toBe("2026-11-02");
  });

  it("/api/week rejects a date that is not YYYY-MM-DD", async () => {
    const app = createApp(dbWithQualityRun(4), () => "2026-11-04", idleRunner());
    expect((await app.request("/api/week?date=next-week")).status).toBe(400);
    expect((await app.request("/api/week?date=2026-13-01")).status).toBe(400);
  });

  it("POST /api/activities/:id/refetch re-fetches the run and responds with it as it now is", async () => {
    const db = dbWithQualityRun(3);
    const fixed = { icu_intervals: Array.from({ length: 4 }, () => ({ type: "WORK", moving_time: 360, gap: 3.3, average_heartrate: 168 })) };
    const refetched: string[] = [];
    const app = createApp(db, () => "2026-10-23", idleRunner(), undefined, async (id) => {
      refetched.push(id);
      saveActivity(db, activity, { intervals: fixed, streams: null }, "2026-11-20T10:00:00.000Z");
      return "Updated";
    });

    const res = await app.request("/api/activities/i1/refetch", { method: "POST" });

    expect(refetched).toEqual(["i1"]);
    const body = (await res.json()) as RefetchResponse;
    expect(body).toMatchObject({ outcome: "Updated", run: { activityId: "i1", complete: true, repsRun: 4, repHr: 168 } });
    const week = (await (await app.request("/api/week")).json()) as WeekResponse;
    expect(week.days.find((d) => d.date === "2026-10-21")!.workouts[0]!.completion).toBe("Complete");
  });

  it("POST /api/activities/:id/refetch says when the Activity is gone", async () => {
    const db = dbWithQualityRun(4);
    const app = createApp(db, () => "2026-10-23", idleRunner(), undefined, async (id) => {
      deleteActivity(db, id);
      return "Deleted";
    });
    const res = await app.request("/api/activities/i1/refetch", { method: "POST" });
    expect(await res.json()).toEqual<RefetchResponse>({ outcome: "Deleted" });
  });

  it("POST /api/activities/:id/refetch responds 502 with the error when intervals.icu fails", async () => {
    const app = createApp(dbWithQualityRun(4), () => "2026-10-23", idleRunner(), undefined, async () => {
      throw new Error("intervals.icu activity/i1 failed: 500");
    });
    const res = await app.request("/api/activities/i1/refetch", { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "intervals.icu activity/i1 failed: 500" });
  });

  it("/api/progress says when intervals.icu last changed each Quality Run's intervals, or null when it does not say", async () => {
    const changed = createApp(dbWithQualityRun(4, "2026-10-24T01:44:28.459+00:00"), () => "2026-10-23", idleRunner());
    const withTime = (await (await changed.request("/api/progress")).json()) as ProgressResponse;
    expect(withTime.cards[0]!.runs[0]!.intervalsChangedAt).toBe("2026-10-24T01:44:28.459+00:00");

    const unknown = createApp(dbWithQualityRun(4), () => "2026-10-23", idleRunner());
    const withoutTime = (await (await unknown.request("/api/progress")).json()) as ProgressResponse;
    expect(withoutTime.cards[0]!.runs[0]!.intervalsChangedAt).toBeNull();
  });
});

describe("/api/volume", () => {
  it("has Weekly Volume for each Training Week through today's, split into Rep Volume and Easy Volume", async () => {
    const db = openDb(":memory:");
    const event = (id: number, date: string, name: string, paired_activity_id: string | null) => ({
      id,
      start_date_local: `${date}T00:00:00`,
      category: "WORKOUT",
      type: "Run",
      name,
      description: "[NSM]",
      paired_activity_id,
    });
    const activity = (id: string, date: string, distance: number) => ({
      id,
      start_date_local: `${date}T07:00:00`,
      type: "Run",
      name: "Everett Running",
      moving_time: 2400,
      distance,
      paired_event_id: null,
    });
    const intervals = {
      icu_intervals: [
        { type: "WORK", moving_time: 600, distance: 2000, gap: 3.3, average_heartrate: 168 },
        { type: "RECOVERY", moving_time: 120, distance: 300, gap: 2.5, average_heartrate: 150 },
      ],
    };
    saveSync(
      db,
      { from: "2026-10-01", to: "2026-10-30" },
      [event(1, "2026-10-13", "Easy Run", null), event(2, "2026-10-20", "1 x 10:00 at 163–177 bpm", "quality")],
      [activity("easy", "2026-10-13", 8000), activity("quality", "2026-10-20", 7000), activity("extra", "2026-10-21", 5000)],
      new Map([["quality", intervals]]),
      { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: "2026-10-23" },
    );
    const app = createApp(db, () => "2026-10-23", idleRunner());

    const { weeks } = (await (await app.request("/api/volume")).json()) as VolumeResponse;

    expect(weeks.map((w) => [w.start, w.reps.distance, w.easy.distance, w.total.distance, w.repShare])).toEqual([
      ["2026-10-12", 0, 8000, 8000, 0],
      ["2026-10-19", 2000, 10000, 12000, 13],
    ]);
  });
});

describe("/api/easy", () => {
  /** An Easy Run's or Long Run's structure: one step at `low`–`high`% of Max HR. */
  const easyHrTarget = (low: number, high: number) => ({ steps: [{ hr: { start: low, end: high, units: "%hr", target: "1s" }, duration: 2820 }] });
  const event = (id: number, date: string, name: string, workout_doc: unknown = easyHrTarget(62, 70)) => ({
    id,
    start_date_local: `${date}T00:00:00`,
    category: "WORKOUT",
    type: "Run",
    name,
    description: "[NSM]",
    paired_activity_id: null,
    workout_doc,
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

  /** A streams response sampled once a second: each stretch is `seconds` at a heart rate and a cadence (per foot). */
  function streams(...stretches: [seconds: number, hr: number, cadence: number][]) {
    const samples = stretches.flatMap(([seconds, hr, cadence]) => Array.from({ length: seconds }, () => [hr, cadence] as const));
    return [
      { type: "time", data: samples.map((_, i) => i) },
      { type: "heartrate", data: samples.map(([hr]) => hr) },
      { type: "cadence", data: samples.map(([, cadence]) => cadence) },
    ];
  }

  /** Synced Planned Workouts and Activities, with streams by Activity id, and the athlete's Max HR, read on `today`. */
  async function easy(
    events: ReturnType<typeof event>[],
    activities: ReturnType<typeof activity>[],
    { maxHr = 200 as number | null, today = "2026-10-24", streamsById = new Map<string, unknown>() } = {},
  ): Promise<EasyResponse> {
    const db = openDb(":memory:");
    saveSync(
      db,
      { from: "2026-01-01", to: "2026-12-31" },
      events,
      activities,
      new Map(),
      { finishedAt: "2026-10-23T12:00:00.000Z", syncedThrough: today },
      streamsById,
    );
    saveAthleteSettings(db, { runThresholdPace: null, maxHr });
    const app = createApp(db, () => today, idleRunner());
    return (await (await app.request("/api/easy")).json()) as EasyResponse;
  }

  it("gives each Matched Easy Run and Long Run its Easy Pace at the middle of the current Easy HR Target", async () => {
    const { referenceHr, runs } = await easy(
      [
        event(1, "2026-10-13", "Easy Run", easyHrTarget(60, 68)),
        event(2, "2026-10-20", "Easy Run"),
        event(3, "2026-10-24", "Long Run"),
        event(4, "2026-10-29", "Easy Run", easyHrTarget(70, 80)),
      ],
      [
        activity("old", "2026-10-13", { gap: 2.3, average_heartrate: 115 }),
        activity("easy", "2026-10-20", { gap: 2.4, average_heartrate: 144 }),
        activity("long", "2026-10-24", { gap: 2.2 }),
        activity("extra", "2026-10-22", { gap: 2.0, average_heartrate: 122 }),
      ],
    );

    // The latest target on or before today is 62–70% of a 200 bpm Max HR: 132 bpm in the middle.
    expect(referenceHr).toBe(132);
    expect(runs.map((r) => [r.activityId, r.runType, r.easyGap, r.easyHr])).toEqual([
      ["old", "Easy Run", 2.3, 115],
      ["easy", "Easy Run", 2.4, 144],
      ["long", "Long Run", 2.2, null],
    ]);
    // 2.3 m/s × 132 / 115 and 2.4 m/s × 132 / 144; a run without Easy HR has no Easy Pace.
    expect(runs.map((r) => r.easyPace)).toEqual([expect.closeTo(2.64, 10), expect.closeTo(2.2, 10), null]);
  });

  it("has no Easy Pace without Max HR or an Easy HR Target", async () => {
    const run = [activity("easy", "2026-10-20", { gap: 2.4, average_heartrate: 144 })];
    const noMaxHr = await easy([event(1, "2026-10-20", "Easy Run")], run, { maxHr: null });
    const noTarget = await easy([event(1, "2026-10-20", "Easy Run", null)], run);
    for (const { referenceHr, runs } of [noMaxHr, noTarget]) {
      expect(referenceHr).toBeNull();
      expect(runs.map((r) => [r.activityId, r.easyPace])).toEqual([["easy", null]]);
    }
  });

  it("has each Run Type's Easy Pace trend over the last 6 Training Weeks, or Not enough data with fewer than 3 runs", async () => {
    // At Easy HR 132 bpm, the reference HR, Easy Pace is Easy GAP.
    const at = (secondsPerMile: number) => ({ gap: 1609.344 / secondsPerMile, average_heartrate: 132 });
    const { trends } = await easy(
      [
        event(1, "2026-08-03", "Easy Run"),
        event(2, "2026-09-14", "Easy Run"),
        event(3, "2026-09-28", "Easy Run"),
        event(4, "2026-10-19", "Easy Run"),
        event(5, "2026-09-20", "Long Run"),
        event(6, "2026-10-18", "Long Run"),
      ],
      [
        activity("before", "2026-08-03", at(700)),
        activity("e1", "2026-09-14", at(600)),
        activity("e2", "2026-09-28", at(596)),
        activity("e3", "2026-10-19", at(590)),
        activity("l1", "2026-09-20", at(640)),
        activity("l2", "2026-10-18", at(630)),
      ],
    );

    // Today is Saturday 24 Oct, so the window runs from Monday 14 Sep. The line loses 10 s/mi every 35 days.
    const easyTrend = trends["Easy Run"];
    expect(easyTrend).toMatchObject({ from: "2026-09-14", to: "2026-10-24" });
    expect(secondsPerMile(easyTrend.line!.start)).toBeCloseTo(600, 6);
    expect(secondsPerMile(easyTrend.line!.end)).toBeCloseTo(600 - (10 * 40) / 35, 6);
    expect(trends["Long Run"]).toEqual({ from: "2026-09-14", to: "2026-10-24", line: null, greyZoneRuns: 0 });
  });

  it("gives each run its Walk Break time: stretches of at least 15 seconds below 130 steps/min, stops left out", async () => {
    const { runs } = await easy(
      [event(1, "2026-10-20", "Easy Run"), event(2, "2026-10-24", "Long Run")],
      [
        activity("easy", "2026-10-20", { gap: 2.4, average_heartrate: 132 }),
        activity("long", "2026-10-24", { gap: 2.3, average_heartrate: 132 }),
      ],
      {
        // intervals.icu gives cadence per foot: 80 is running at 160 steps/min, 60 walking at 120.
        streamsById: new Map([
          ["easy", streams([600, 132, 80], [20, 125, 60], [300, 132, 80], [14, 125, 60], [100, 132, 80], [30, 120, 0], [40, 130, 64])],
        ]),
      },
    );

    // 20 s and 40 s walked; 14 s is too short to be a Walk Break, and a stop (cadence 0) is not one.
    expect(runs.map((r) => [r.activityId, r.walkBreakTime])).toEqual([
      ["easy", 60],
      ["long", null],
    ]);
    expect(runs[1]!.easyPace).toBeCloseTo(2.3, 10);
  });

  it("does not join walking either side of a pause in recording into one Walk Break", async () => {
    // 100 s running, 10 s walking, a pause, then 10 s more walking.
    const time = [...Array.from({ length: 110 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 200 + i)];
    const cadence = time.map((_, i) => (i < 100 ? 80 : 60));
    const { runs } = await easy([event(1, "2026-10-20", "Easy Run")], [activity("easy", "2026-10-20", { gap: 2.4, average_heartrate: 132 })], {
      streamsById: new Map([["easy", [{ type: "time", data: time }, { type: "cadence", data: cadence }]]]),
    });
    expect(runs[0]!.walkBreakTime).toBe(0);
  });

  it("flags runs by their share of moving time above the top of the Easy HR Target", async () => {
    const { runs } = await easy(
      [event(1, "2026-10-19", "Easy Run"), event(2, "2026-10-20", "Easy Run"), event(3, "2026-10-21", "Easy Run"), event(4, "2026-10-24", "Long Run")],
      [
        activity("steady", "2026-10-19", { gap: 2.4, average_heartrate: 132 }),
        activity("over", "2026-10-20", { gap: 2.4, average_heartrate: 134 }),
        activity("grey", "2026-10-21", { gap: 2.5, average_heartrate: 138 }),
        activity("no-streams", "2026-10-24", { gap: 2.3, average_heartrate: 132 }),
      ],
      {
        // The top of 62–70% of a 200 bpm Max HR is 140 bpm. A stop (cadence 0) is not moving time.
        streamsById: new Map([
          ["steady", streams([90, 135, 80], [10, 141, 80])],
          ["over", streams([85, 135, 80], [15, 145, 80], [60, 150, 0])],
          ["grey", streams([70, 135, 60], [30, 145, 80])],
        ]),
      },
    );

    expect(runs.map((r) => [r.activityId, r.easyHrTargetTop, r.timeAboveTarget, r.overTarget, r.greyZone])).toEqual([
      ["steady", 140, expect.closeTo(0.1, 10), false, false],
      ["over", 140, expect.closeTo(0.15, 10), true, false],
      ["grey", 140, expect.closeTo(0.3, 10), true, true],
      ["no-streams", 140, null, false, false],
    ]);
  });

  it("leaves Grey Zone Runs out of the trend, and counts them in the window", async () => {
    const at = (secondsPerMile: number) => ({ gap: 1609.344 / secondsPerMile, average_heartrate: 132 });
    const { runs, trends } = await easy(
      [
        event(1, "2026-09-07", "Easy Run"),
        event(2, "2026-09-14", "Easy Run"),
        event(3, "2026-09-28", "Easy Run"),
        event(4, "2026-10-05", "Easy Run"),
        event(5, "2026-10-19", "Easy Run"),
      ],
      [
        activity("grey-before", "2026-09-07", at(560)),
        activity("e1", "2026-09-14", at(600)),
        activity("e2", "2026-09-28", at(596)),
        activity("grey", "2026-10-05", at(560)),
        activity("e3", "2026-10-19", at(590)),
      ],
      {
        streamsById: new Map([
          ["grey-before", streams([60, 135, 80], [40, 150, 80])],
          ["grey", streams([60, 135, 80], [40, 150, 80])],
        ]),
      },
    );

    expect(runs.find((r) => r.activityId === "grey")!.easyPace).not.toBeNull();
    const trend = trends["Easy Run"];
    expect(trend.greyZoneRuns).toBe(1);
    expect(secondsPerMile(trend.line!.start)).toBeCloseTo(600, 6);
    expect(secondsPerMile(trend.line!.end)).toBeCloseTo(600 - (10 * 40) / 35, 6);
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

    saveAthleteSettings(db, { runThresholdPace: 3.0, maxHr: null });
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
