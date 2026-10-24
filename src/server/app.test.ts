import { describe, expect, it } from "vitest";
import {
  createApp,
  type EasyResponse,
  type ProgressResponse,
  type SyncStatusResponse,
  type VolumeResponse,
  type WeekResponse,
} from "./app";
import { openDb } from "./db";
import { saveSync } from "./store";
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

    expect(runs.map((r) => [r.activityId, r.runType, r.gap, r.averageHeartrate])).toEqual([
      ["easy", "Easy Run", 2.36, 139],
      ["long", "Long Run", 2.2, null],
    ]);
  });
});

function idleRunner(sync = () => {}): SyncRunner {
  return { run: async () => sync(), running: false };
}
