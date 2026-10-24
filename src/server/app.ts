import { Hono } from "hono";
import { easyTrend, type EasyTrendRun } from "../domain/easyTrend";
import {
  repLengthCards,
  type AnalysedActivity,
  type AnalysedPlannedWorkout,
  type RepLengthCard,
} from "../domain/repProgress";
import { lt1Hr, lthr, paceAt, paceLine, thresholdTrend, type ThresholdWeek } from "../domain/thresholdPace";
import { trainingWeek, weekStart, type TrainingDay, type TrainingWeek, type WeekWorkout } from "../domain/trainingWeek";
import { weeklyVolume, type VolumeWeek } from "../domain/weeklyVolume";
import type { Db } from "./db";
import { activityAverages, detectedIntervals, plannedRecovery } from "./intervals";
import { loadActivities, loadPlannedWorkouts, loadRunThresholdPace, loadSyncStatus, type StoredActivity } from "./store";
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
export interface VolumeResponse {
  /** Oldest first; the last is this Training Week. */
  weeks: VolumeWeek[];
}
export interface EasyResponse {
  /** Oldest first. */
  runs: EasyTrendRun[];
}
export interface ThresholdsResponse {
  /** The current LTHR in bpm; null when no Quality Run names a heart-rate target. */
  lthr: number | null;
  /** LT2 Pace as a grade-adjusted speed in metres per second; null without LTHR or with Not enough data. */
  lt2Pace: number | null;
  /** LT1 HR in bpm; null without LTHR. */
  lt1Hr: number | null;
  /** LT1 HR was assumed from LTHR rather than set by the runner. */
  lt1HrAssumed: boolean;
  /** LT1 Pace as a grade-adjusted speed in metres per second; null without LTHR or with Not enough data. */
  lt1Pace: number | null;
  /** The intervals.icu Threshold Pace in metres per second, a reference beside LT2 Pace; null when none is synced. */
  icuThresholdPace: number | null;
  /** LT1 Pace and LT2 Pace as of each Training Week since the plan began, oldest first; empty without LTHR. */
  weeks: ThresholdWeek[];
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

export function createApp(db: Db, today: () => string, syncRunner: SyncRunner, settings: Settings = { lt1Hr: null }) {
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
      const analysedPlanned = analysedPlannedWorkouts(db);
      const planned = analysedPlanned.map(({ recovery: _, ...p }) => p);
      const analysed = analysedActivities(db);
      const activities = analysed.map(({ intervals: _, ...a }) => a);
      const week = trainingWeek(date, planned, activities);
      const qualityRuns = repLengthCards(analysedPlanned, analysed).flatMap((card) => card.runs);
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
      return c.json<ProgressResponse>({ cards: repLengthCards(analysedPlannedWorkouts(db), analysedActivities(db)) });
    })
    .get("/api/volume", (c) => {
      const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
      const activities = loadActivities(db).map(({ raw: _, intervals: __, ...a }) => a);
      return c.json<VolumeResponse>({ weeks: weeklyVolume(today(), planned, activities) });
    })
    .get("/api/easy", (c) => c.json<EasyResponse>({ runs: easyRuns(db) }))
    .get("/api/thresholds", (c) => {
      const date = today();
      const analysedPlanned = analysedPlannedWorkouts(db);
      const qualityRuns = repLengthCards(analysedPlanned, analysedActivities(db)).flatMap((card) => card.runs);
      const current = lthr(analysedPlanned, date);
      const easy = easyRuns(db);
      const line = paceLine(weekStart(date), qualityRuns, easy);
      const lt1 = current === null ? null : lt1Hr(current, settings.lt1Hr);
      const planStart = analysedPlanned[0]?.date;
      return c.json<ThresholdsResponse>({
        lthr: current,
        lt2Pace: current === null || line === null ? null : paceAt(line, current),
        lt1Hr: lt1?.bpm ?? null,
        lt1HrAssumed: lt1?.assumed ?? settings.lt1Hr === null,
        lt1Pace: lt1 === null || line === null ? null : paceAt(line, lt1.bpm),
        icuThresholdPace: loadRunThresholdPace(db),
        weeks:
          current === null || lt1 === null || planStart === undefined
            ? []
            : thresholdTrend(planStart, date, qualityRuns, easy, { lthr: current, lt1Hr: lt1.bpm }),
      });
    })
    .get("/api/sync", (c) => c.json(syncStatus()))
    .post("/api/sync", async (c) => {
      await syncRunner.run();
      return c.json(syncStatus());
    });
}

/** Every Matched Easy Run and Long Run with its Easy GAP and Easy HR, oldest first. */
function easyRuns(db: Db): EasyTrendRun[] {
  const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
  const activities = loadActivities(db).map(({ raw, intervals: _, ...a }) => ({ ...a, ...activityAverages(raw) }));
  return easyTrend(planned, activities);
}

/** Stored Planned Workouts without their raw response, with their planned recovery read. */
function analysedPlannedWorkouts(db: Db): AnalysedPlannedWorkout[] {
  return loadPlannedWorkouts(db).map(({ raw, ...p }) => ({ ...p, recovery: plannedRecovery(raw) }));
}

/** Stored Activities without their raw response, with their detected intervals read. */
function analysedActivities(db: Db): (AnalysedActivity & Pick<StoredActivity, "distance">)[] {
  return loadActivities(db).map(({ raw: _, intervals, ...a }) => ({
    ...a,
    intervals: intervals === null ? null : detectedIntervals(intervals),
  }));
}
