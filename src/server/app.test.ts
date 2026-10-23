import { describe, expect, it } from "vitest";
import { createApp, type ProgressResponse, type SyncStatusResponse, type WeekResponse } from "./app";
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
      latest: { date: "2026-10-21", complete: true, repsRun: 4, repGap: 3.2, repHr: 166 },
      previous: null,
    });
  });
});

function idleRunner(sync = () => {}): SyncRunner {
  return { run: async () => sync(), running: false };
}
