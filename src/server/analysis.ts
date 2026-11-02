import { currentEasyHrTarget, easyTrend, type EasyHrTarget, type EasyPlannedWorkout, type EasyTrend } from "../domain/easyTrend";
import { fitnessDays, type FitnessDay, type ScoredWorkout } from "../domain/fitness";
import { addDays } from "../domain/localDate";
import { matchActivities } from "../domain/matching";
import { plannedTrainingLoad, trainingLoad } from "../domain/trainingLoad";
import { repLengthCards, type AnalysedActivity, type AnalysedPlannedWorkout, type RepLengthRun } from "../domain/repProgress";
import type { Db } from "./db";
import {
  activityAverages,
  activityStreams,
  detectedIntervals,
  intervalsAnalyzedAt,
  plannedEasyHrTarget,
  plannedRecovery,
  plannedSteps,
  recordedLoadInputs,
} from "./intervals";
import {
  historyStart,
  loadActivities,
  loadAthleteSettings,
  loadCrossTraining,
  loadFitnessStart,
  loadPlannedWorkouts,
  loadPlannerSettings,
  type StoredActivity,
} from "./store";

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
 * Cross-Training workout, each scored against the thresholds intervals.icu recorded with it, WeightTraining counting
 * toward Fatigue only, and from the Planned Training Load of each of today's Planned Workouts not yet Matched. They
 * start from the Fitness and Fatigue stored for a day before stored history, or from zero without one. A workout whose
 * streams are not fetched yet is left out until they are. Empty without stored history; never earlier than its first
 * day.
 */
export function fitness(db: Db, today: string, days: number): FitnessDay[] {
  const start = historyStart(db);
  if (start === null) return [];
  const activities = loadActivities(db);
  const done: ScoredWorkout[] = [
    ...activities.map((w) => ({ ...w, running: true })),
    ...loadCrossTraining(db).map((w) => ({ ...w, running: false })),
  ]
    .filter((w) => w.streams !== null)
    .map((w) => ({
      date: w.date,
      trainingLoad: trainingLoad({ running: w.running, ...recordedLoadInputs(w.raw), streams: activityStreams(w.streams) }),
      countsTowardFitness: w.type !== WEIGHT_TRAINING,
      planned: false,
    }));
  const stored = loadFitnessStart(db);
  const scored = [...done, ...todaysPlannedLoads(db, activities, today)];
  return fitnessDays(scored, start, stored !== null && stored.date < start ? stored : null, addDays(today, 1 - days), today);
}

/** The Cross-Training intervals.icu counts toward Fatigue only. */
const WEIGHT_TRAINING = "WeightTraining";

/**
 * Today's Planned Workouts not yet Matched, scored by their Planned Training Load against the current thresholds: LTHR
 * and Max HR from the intervals.icu Run settings, and the resting HR recorded with the latest Activity that has one.
 * One that cannot be estimated is left out. Planned Workouts of earlier days never count.
 */
function todaysPlannedLoads(db: Db, activities: StoredActivity[], today: string): ScoredWorkout[] {
  const planned = loadPlannedWorkouts(db);
  const matched = new Set(matchActivities(planned, activities).map((m) => m.plannedWorkoutId));
  const unMatched = planned.filter((p) => p.date === today && !matched.has(p.id));
  if (unMatched.length === 0) return [];
  const { lthr, maxHr } = loadAthleteSettings(db);
  const restingHr = activities.map((a) => recordedLoadInputs(a.raw).thresholds.restingHr).findLast((hr) => hr !== null) ?? null;
  const easy = easyHrTarget(db, today);
  return unMatched.flatMap((p) => {
    const load = plannedTrainingLoad(plannedSteps(p.raw), { lthr, maxHr, restingHr }, easy);
    return load === null ? [] : [{ date: today, trainingLoad: load, countsTowardFitness: true, planned: true }];
  });
}

/** The Easy HR Target set for the planner, or else the current one: that of the latest Easy Run or Long Run planned. */
export function easyHrTarget(db: Db, today: string): EasyHrTarget | null {
  return loadPlannerSettings(db).easyHrTarget ?? currentEasyHrTarget(easyPlannedWorkouts(db), today);
}
