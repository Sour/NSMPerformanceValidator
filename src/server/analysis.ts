import { easyTrend, type EasyPlannedWorkout, type EasyTrend } from "../domain/easyTrend";
import { repLengthCards, type AnalysedActivity, type AnalysedPlannedWorkout, type RepLengthRun } from "../domain/repProgress";
import type { Db } from "./db";
import { activityAverages, activityStreams, detectedIntervals, intervalsAnalyzedAt, plannedEasyHrTarget, plannedRecovery } from "./intervals";
import { loadActivities, loadAthleteSettings, loadPlannedWorkouts, type StoredActivity } from "./store";

/** Every Matched Quality Run with its Reps, across all Rep Lengths. */
export function qualityRuns(planned: AnalysedPlannedWorkout[], activities: AnalysedActivity[]): RepLengthRun[] {
  return repLengthCards(planned, activities).flatMap((card) => card.runs);
}

/** Every Matched Easy Run and Long Run with its Easy GAP, Easy HR and Easy Pace, oldest first. */
export function easyRuns(db: Db, today: string): EasyTrend {
  const planned = easyPlannedWorkouts(db);
  const activities = loadActivities(db).map(({ raw, intervals: _, streams, ...a }) => ({
    ...a,
    ...activityAverages(raw),
    streams: activityStreams(streams),
  }));
  return easyTrend(planned, activities, today, loadAthleteSettings(db).maxHr);
}

/** Stored Planned Workouts without their raw response, with their Easy HR Target read. */
export function easyPlannedWorkouts(db: Db): EasyPlannedWorkout[] {
  return loadPlannedWorkouts(db).map(({ raw, ...p }) => ({ ...p, easyHrTarget: plannedEasyHrTarget(raw) }));
}

/** Stored Planned Workouts without their raw response, with their planned recovery read. */
export function analysedPlannedWorkouts(db: Db): AnalysedPlannedWorkout[] {
  return loadPlannedWorkouts(db).map(({ raw, ...p }) => ({ ...p, recovery: plannedRecovery(raw) }));
}

/** Stored Activities without their raw response, with their detected intervals and when they last changed read. */
export function analysedActivities(db: Db): (AnalysedActivity & Pick<StoredActivity, "distance">)[] {
  return loadActivities(db).map(({ raw: _, intervals, streams: __, ...a }) => ({
    ...a,
    intervals: intervals === null ? null : detectedIntervals(intervals),
    intervalsChangedAt: intervalsAnalyzedAt(intervals),
  }));
}
