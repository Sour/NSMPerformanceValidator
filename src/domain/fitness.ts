import { addDays, daysBetween } from "./localDate";

/** How far back the Fitness graph looks, as days through today: 6 weeks, 3 months, 6 months or 1 year. */
export const FITNESS_RANGES = { "6w": 42, "3m": 91, "6m": 182, "1y": 365 } as const;
export type FitnessRange = keyof typeof FITNESS_RANGES;
export const DEFAULT_FITNESS_RANGE: FitnessRange = "3m";

export function isFitnessRange(text: string): text is FitnessRange {
  return Object.hasOwn(FITNESS_RANGES, text);
}

/** An Activity or Cross-Training workout as far as Fitness goes. */
export interface ScoredWorkout {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Null when it has no heart rate at all. */
  trainingLoad: number | null;
}

export interface FitnessDay {
  /** YYYY-MM-DD. */
  date: string;
  /** The day's workouts' Training Load added up; 0 for a day without any. */
  trainingLoad: number;
  fitness: number;
  fatigue: number;
  /** Fitness − Fatigue, that day's workouts included. */
  form: number;
  /** How many of the day's workouts had no heart rate at all, and so no Training Load. */
  withoutHeartRate: number;
  /** Within the first 42 days of stored history, while Fitness is still rising from zero. */
  settling: boolean;
}

/** Fitness's and Fatigue's time constants, in days. Fitness settles for as long after stored history starts. */
export const FITNESS_DAYS = 42;
const FATIGUE_DAYS = 7;

/**
 * Fitness, Fatigue and Form for each day from `from` through `to`. Both start from zero on `historyStart`, the first
 * day of stored history, and each day move toward that day's Training Load by 1 − e^(−1/τ) of the gap, τ being 42 days
 * for Fitness and 7 for Fatigue: exponentially weighted averages, as intervals.icu's are. A day without workouts adds
 * 0, so both decay. Days before `historyStart` are not given.
 */
export function fitnessDays(workouts: ScoredWorkout[], historyStart: string, from: string, to: string): FitnessDay[] {
  const fitnessWeight = 1 - Math.exp(-1 / FITNESS_DAYS);
  const fatigueWeight = 1 - Math.exp(-1 / FATIGUE_DAYS);
  const byDate = new Map<string, ScoredWorkout[]>();
  for (const w of workouts) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);

  const days: FitnessDay[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let date = historyStart; date <= to; date = addDays(date, 1)) {
    const today = byDate.get(date) ?? [];
    const trainingLoad = today.reduce((sum, w) => sum + (w.trainingLoad ?? 0), 0);
    fitness += (trainingLoad - fitness) * fitnessWeight;
    fatigue += (trainingLoad - fatigue) * fatigueWeight;
    if (date < from) continue;
    days.push({
      date,
      trainingLoad,
      fitness,
      fatigue,
      form: fitness - fatigue,
      withoutHeartRate: today.filter((w) => w.trainingLoad === null).length,
      settling: daysBetween(historyStart, date) < FITNESS_DAYS,
    });
  }
  return days;
}
