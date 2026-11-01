import { easyTrend, type EasyPlannedWorkout, type EasyTrend } from "../domain/easyTrend";
import { fitnessDays, type FitnessDay } from "../domain/fitness";
import { addDays } from "../domain/localDate";
import { lthrOn } from "../domain/thresholdPace";
import { trainingLoad } from "../domain/trainingLoad";
import { repLengthCards, type AnalysedActivity, type AnalysedPlannedWorkout, type RepLengthRun } from "../domain/repProgress";
import type { Db } from "./db";
import { activityAverages, activityStreams, detectedIntervals, intervalsAnalyzedAt, plannedEasyHrTarget, plannedRecovery } from "./intervals";
import { loadActivities, loadAthleteSettings, loadCrossTraining, loadPlannedWorkouts, type StoredActivity } from "./store";

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

/**
 * Fitness, Fatigue and Form for each of the `days` days through `today`, from the Training Load of every Activity and
 * Cross-Training workout, each measured against the LTHR in effect on its day. A workout whose streams are not fetched
 * yet is left out until they are. Empty while no Quality Run names a target, or without stored history; never earlier
 * than the first day of stored history.
 */
export function fitness(db: Db, today: string, days: number): FitnessDay[] {
  const planned = loadPlannedWorkouts(db);
  const workouts = [...loadActivities(db), ...loadCrossTraining(db)];
  const historyStart = [...planned, ...workouts].map((w) => w.date).sort()[0];
  if (historyStart === undefined || lthrOn(planned, today) === null) return [];
  const scored = workouts
    .filter((w) => w.streams !== null)
    .map((w) => ({ date: w.date, trainingLoad: trainingLoad(activityStreams(w.streams), lthrOn(planned, w.date)!) }));
  return fitnessDays(scored, historyStart, addDays(today, 1 - days), today);
}
