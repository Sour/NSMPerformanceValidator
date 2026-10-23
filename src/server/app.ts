import { Hono } from "hono";
import { repLengthCards, type AnalysedActivity, type RepLengthCard } from "../domain/repProgress";
import { trainingWeek, type TrainingDay, type TrainingWeek, type WeekWorkout } from "../domain/trainingWeek";
import type { Db } from "./db";
import { detectedIntervals } from "./intervals";
import { loadActivities, loadPlannedWorkouts, loadSyncStatus, type StoredActivity } from "./store";
import type { SyncRunner } from "./syncRunner";

export type WeekActivity = Omit<StoredActivity, "raw" | "intervals">;
/** A Matched Quality Run is Complete or Incomplete; null for other Planned Workouts. */
export type WeekWorkoutResponse = WeekWorkout<WeekActivity> & { completion: "Complete" | "Incomplete" | null };
export type WeekResponse = Omit<TrainingWeek<WeekActivity>, "days"> & {
  today: string;
  days: (Omit<TrainingDay<WeekActivity>, "workouts"> & { workouts: WeekWorkoutResponse[] })[];
};
export interface ProgressResponse {
  cards: RepLengthCard[];
}
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
      const analysed = analysedActivities(db);
      const activities = analysed.map(({ intervals: _, ...a }) => a);
      const week = trainingWeek(date, planned, activities);
      const qualityRuns = repLengthCards(planned, analysed).flatMap((card) => card.runs);
      const completion = (w: WeekWorkout<WeekActivity>): WeekWorkoutResponse["completion"] => {
        const run = qualityRuns.find((r) => r.activityId === w.activity?.id);
        if (!run) return null;
        return run.complete ? "Complete" : "Incomplete";
      };
      return c.json<WeekResponse>({
        today: date,
        ...week,
        days: week.days.map((d) => ({ ...d, workouts: d.workouts.map((w) => ({ ...w, completion: completion(w) })) })),
      });
    })
    .get("/api/progress", (c) => {
      const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
      return c.json<ProgressResponse>({ cards: repLengthCards(planned, analysedActivities(db)) });
    })
    .get("/api/sync", (c) => c.json(syncStatus()))
    .post("/api/sync", async (c) => {
      await syncRunner.run();
      return c.json(syncStatus());
    });
}

/** Stored Activities without their raw response, with their detected intervals read. */
function analysedActivities(db: Db): (AnalysedActivity & Pick<StoredActivity, "distance">)[] {
  return loadActivities(db).map(({ raw: _, intervals, ...a }) => ({
    ...a,
    intervals: intervals === null ? null : detectedIntervals(intervals),
  }));
}
