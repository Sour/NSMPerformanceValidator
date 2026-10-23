import { Hono } from "hono";
import { trainingWeek, type TrainingWeek } from "../domain/trainingWeek";
import type { Db } from "./db";
import { loadActivities, loadPlannedWorkouts, loadSyncStatus, type StoredActivity } from "./store";
import type { SyncRunner } from "./syncRunner";

export type WeekActivity = Omit<StoredActivity, "raw">;
export type WeekResponse = TrainingWeek<WeekActivity> & { today: string };
export interface SyncStatusResponse {
  /** When the latest sync finished, as an ISO timestamp. */
  lastFinishedAt: string | null;
  /** When the latest successful sync finished, as an ISO timestamp. */
  lastSucceededAt: string | null;
  /** Why the latest sync failed; null when it succeeded. */
  lastError: string | null;
  /** Whether a sync is running now. */
  running: boolean;
}

export function createApp(db: Db, today: () => string, syncRunner: SyncRunner) {
  const syncStatus = (): SyncStatusResponse => {
    const status = loadSyncStatus(db);
    return {
      lastFinishedAt: status?.finishedAt ?? null,
      lastSucceededAt: status?.succeededAt ?? null,
      lastError: status?.error ?? null,
      running: syncRunner.running,
    };
  };

  return new Hono()
    .get("/api/week", (c) => {
      const date = today();
      const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
      const activities = loadActivities(db).map(({ raw: _, ...a }) => a);
      return c.json<WeekResponse>({ today: date, ...trainingWeek(date, planned, activities) });
    })
    .get("/api/sync", (c) => c.json(syncStatus()))
    .post("/api/sync", async (c) => {
      await syncRunner.run();
      return c.json(syncStatus());
    });
}
