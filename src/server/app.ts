import { Hono } from "hono";
import { easyTrend, type EasyTrend } from "../domain/easyTrend";
import {
  repLengthCards,
  type AnalysedActivity,
  type AnalysedPlannedWorkout,
  type RepLengthCard,
  type RepLengthRun,
} from "../domain/repProgress";
import { thresholdPaces, type ThresholdPaces } from "../domain/thresholdPace";
import { isLocalDate } from "../domain/localDate";
import {
  trainingWeek,
  trainingWeekRange,
  type TrainingDay,
  type TrainingWeek,
  type TrainingWeekRange,
  type WeekWorkout,
} from "../domain/trainingWeek";
import { weeklyVolume, type VolumeWeek } from "../domain/weeklyVolume";
import type { Db } from "./db";
import { activityAverages, activityStreams, detectedIntervals, intervalsAnalyzedAt, plannedEasyHrTarget, plannedRecovery } from "./intervals";
import { loadActivities, loadPlannedWorkouts, loadAthleteSettings, loadSyncStatus, type StoredActivity } from "./store";
import type { RefetchOutcome } from "./sync";
import type { SyncRunner } from "./syncRunner";

export type WeekActivity = Omit<StoredActivity, "raw" | "intervals" | "streams">;
/** A Matched Quality Run is Complete or Incomplete; null for other Planned Workouts. */
export type WeekWorkoutResponse = WeekWorkout<WeekActivity> & { completion: "Complete" | "Incomplete" | null };
/** The Training Week asked for, and through `earliest` and `latest` how far back and forward weeks may be asked for. */
export type WeekResponse = Omit<TrainingWeek<WeekActivity>, "days"> &
  TrainingWeekRange & {
  today: string;
  days: (Omit<TrainingDay<WeekActivity>, "workouts"> & { workouts: WeekWorkoutResponse[] })[];
};
export interface ProgressResponse {
  cards: RepLengthCard[];
}
/** A re-fetched Activity is either still Matched to a Quality Run, given as that run now is, or no longer. */
export type RefetchResponse = { outcome: "Updated"; run: RepLengthRun } | { outcome: Exclude<RefetchOutcome, "Updated"> };
export interface VolumeResponse {
  /** Oldest first; the last is this Training Week. */
  weeks: VolumeWeek[];
}
export type EasyResponse = EasyTrend;
export interface ThresholdsResponse extends ThresholdPaces {
  /** The intervals.icu Threshold Pace in metres per second, a reference beside LT2 Pace; null when none is synced. */
  icuThresholdPace: number | null;
}

/** What the runner has set for the app. */
export interface Settings {
  /** The runner's own LT1 HR in bpm; null to assume it from LTHR. */
  lt1Hr: number | null;
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

/** Reloads one Activity from intervals.icu; see `refetchActivity`. */
export type Refetch = (activityId: string) => Promise<RefetchOutcome>;

export function createApp(
  db: Db,
  today: () => string,
  syncRunner: SyncRunner,
  settings: Settings = { lt1Hr: null },
  refetch: Refetch = async () => {
    throw new Error("Re-fetch is not available");
  },
) {
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
      const viewed = c.req.query("date") ?? date;
      if (!isLocalDate(viewed)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
      const analysedPlanned = analysedPlannedWorkouts(db);
      const planned = analysedPlanned.map(({ recovery: _, ...p }) => p);
      const analysed = analysedActivities(db);
      const activities = analysed.map(({ intervals: _, intervalsChangedAt: __, ...a }) => a);
      const week = trainingWeek(date, planned, activities, viewed);
      const runs = qualityRuns(analysedPlanned, analysed);
      const completion = (w: WeekWorkout<WeekActivity>): WeekWorkoutResponse["completion"] => {
        const run = runs.find((r) => r.activityId === w.activity?.id);
        if (!run) return null;
        return run.complete ? "Complete" : "Incomplete";
      };
      return c.json<WeekResponse>({
        today: date,
        ...week,
        ...trainingWeekRange(date, planned),
        days: week.days.map((d) => ({ ...d, workouts: d.workouts.map((w) => ({ ...w, completion: completion(w) })) })),
      });
    })
    .get("/api/progress", (c) => {
      return c.json<ProgressResponse>({ cards: repLengthCards(analysedPlannedWorkouts(db), analysedActivities(db)) });
    })
    .get("/api/volume", (c) => {
      const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
      return c.json<VolumeResponse>({ weeks: weeklyVolume(today(), planned, analysedActivities(db)) });
    })
    .get("/api/easy", (c) => c.json<EasyResponse>(easyRuns(db, today())))
    .get("/api/thresholds", (c) => {
      const analysedPlanned = analysedPlannedWorkouts(db);
      const runs = qualityRuns(analysedPlanned, analysedActivities(db));
      return c.json<ThresholdsResponse>({
        ...thresholdPaces(analysedPlanned, runs, easyRuns(db, today()).runs, today(), settings.lt1Hr),
        icuThresholdPace: loadAthleteSettings(db).runThresholdPace,
      });
    })
    .post("/api/activities/:id/refetch", async (c) => {
      let outcome: RefetchOutcome;
      try {
        outcome = await refetch(c.req.param("id"));
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
      if (outcome !== "Updated") return c.json<RefetchResponse>({ outcome });
      const run = qualityRuns(analysedPlannedWorkouts(db), analysedActivities(db)).find((r) => r.activityId === c.req.param("id"));
      return c.json<RefetchResponse>(run ? { outcome, run } : { outcome: "NotQualityRun" });
    })
    .get("/api/sync", (c) => c.json(syncStatus()))
    .post("/api/sync", async (c) => {
      await syncRunner.run();
      return c.json(syncStatus());
    });
}

/** Every Matched Quality Run with its Reps, across all Rep Lengths. */
function qualityRuns(planned: AnalysedPlannedWorkout[], activities: AnalysedActivity[]): RepLengthRun[] {
  return repLengthCards(planned, activities).flatMap((card) => card.runs);
}

/** Every Matched Easy Run and Long Run with its Easy GAP, Easy HR and Easy Pace, oldest first. */
function easyRuns(db: Db, today: string): EasyTrend {
  const planned = loadPlannedWorkouts(db).map(({ raw, ...p }) => ({ ...p, easyHrTarget: plannedEasyHrTarget(raw) }));
  const activities = loadActivities(db).map(({ raw, intervals: _, streams, ...a }) => ({
    ...a,
    ...activityAverages(raw),
    streams: activityStreams(streams),
  }));
  return easyTrend(planned, activities, today, loadAthleteSettings(db).maxHr);
}

/** Stored Planned Workouts without their raw response, with their planned recovery read. */
function analysedPlannedWorkouts(db: Db): AnalysedPlannedWorkout[] {
  return loadPlannedWorkouts(db).map(({ raw, ...p }) => ({ ...p, recovery: plannedRecovery(raw) }));
}

/** Stored Activities without their raw response, with their detected intervals and when they last changed read. */
function analysedActivities(db: Db): (AnalysedActivity & Pick<StoredActivity, "distance">)[] {
  return loadActivities(db).map(({ raw: _, intervals, streams: __, ...a }) => ({
    ...a,
    intervals: intervals === null ? null : detectedIntervals(intervals),
    intervalsChangedAt: intervalsAnalyzedAt(intervals),
  }));
}
