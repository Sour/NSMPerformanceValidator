import { addDays, daysBetween } from "./localDate";

/**
 * How far back the Fitness graph looks, as days through today: 1 month, 42 days, 3 months, 6 months or 1 year. The 42
 * days keep the key they had as 6 weeks, so a range remembered then still applies.
 */
export const FITNESS_RANGES = { "1m": 30, "6w": 42, "3m": 91, "6m": 182, "1y": 365 } as const;
export type FitnessRange = keyof typeof FITNESS_RANGES;
export const DEFAULT_FITNESS_RANGE: FitnessRange = "6w";

export function isFitnessRange(text: string): text is FitnessRange {
  return Object.hasOwn(FITNESS_RANGES, text);
}

/** An Activity, a Cross-Training workout or one of today's Planned Workouts not yet Matched, as far as Fitness goes. */
export interface ScoredWorkout {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Null when it has none, as without heart rate or the thresholds recorded with it. */
  trainingLoad: number | null;
  /** False for WeightTraining, which intervals.icu counts toward Fatigue only. */
  countsTowardFitness: boolean;
  /** A Planned Workout not yet done, counted by its Planned Training Load. */
  planned: boolean;
}

/** Where a day's Form falls, named as intervals.icu names them. Optimal is where training builds Fitness. */
export const FORM_ZONES = ["Transition", "Fresh", "Grey Zone", "Optimal", "High Risk"] as const;
export type FormZone = (typeof FORM_ZONES)[number];

/** The lowest whole-number Form in each Form Zone; each runs up to the next one's. */
export const FORM_ZONE_FLOORS: Record<FormZone, number> = {
  Transition: 21,
  Fresh: 6,
  "Grey Zone": -9,
  Optimal: -30,
  "High Risk": -Infinity,
};

/** The Form Zone of `form`, judged on Form rounded to a whole number, as the graph shows it. */
export function formZone(form: number): FormZone {
  const rounded = Math.round(form);
  return FORM_ZONES.find((zone) => rounded >= FORM_ZONE_FLOORS[zone])!;
}

export interface FitnessDay {
  /** YYYY-MM-DD. */
  date: string;
  /** The day's workouts' Training Load added up, `plannedTrainingLoad` included; 0 for a day without any. */
  trainingLoad: number;
  /** The part of `trainingLoad` from Planned Workouts not yet Matched; 0 on every day but today. */
  plannedTrainingLoad: number;
  fitness: number;
  fatigue: number;
  /** Fitness − Fatigue, that day's workouts included. */
  form: number;
  formZone: FormZone;
  /** How many of the day's workouts had no Training Load, as without heart rate. */
  withoutHeartRate: number;
  /** Within the first 42 days of stored history when Fitness started from zero there, while it is still rising. */
  settling: boolean;
}

/** Fitness's and Fatigue's time constants, in days. Fitness started from zero settles for as long. */
export const FITNESS_DAYS = 42;
const FATIGUE_DAYS = 7;

/** Fitness and Fatigue at the end of `date`, a day before stored history starts. */
export interface FitnessStart {
  /** YYYY-MM-DD. */
  date: string;
  fitness: number;
  fatigue: number;
}

/**
 * Fitness, Fatigue and Form for each day from `from` through `to`. Both start from `start`, at the end of a day before
 * `historyStart`, the first day of stored history, or from zero on it without one, and each day move toward that day's
 * Training Load by 1 − e^(−1/τ) of the gap, τ being 42 days for Fitness and 7 for Fatigue: exponentially weighted
 * averages, as intervals.icu's are. Fitness moves toward the Training Load of only the workouts counting toward it. A
 * day without workouts adds 0, so both decay. Days before `historyStart` are not given.
 */
export function fitnessDays(
  workouts: ScoredWorkout[],
  historyStart: string,
  start: FitnessStart | null,
  from: string,
  to: string,
): FitnessDay[] {
  const fitnessWeight = 1 - Math.exp(-1 / FITNESS_DAYS);
  const fatigueWeight = 1 - Math.exp(-1 / FATIGUE_DAYS);
  const byDate = new Map<string, ScoredWorkout[]>();
  for (const w of workouts) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const load = (some: ScoredWorkout[]) => some.reduce((sum, w) => sum + (w.trainingLoad ?? 0), 0);

  const days: FitnessDay[] = [];
  let fitness = start?.fitness ?? 0;
  let fatigue = start?.fatigue ?? 0;
  for (let date = start ? addDays(start.date, 1) : historyStart; date <= to; date = addDays(date, 1)) {
    const today = byDate.get(date) ?? [];
    const trainingLoad = load(today);
    fitness += (load(today.filter((w) => w.countsTowardFitness)) - fitness) * fitnessWeight;
    fatigue += (trainingLoad - fatigue) * fatigueWeight;
    if (date < from || date < historyStart) continue;
    days.push({
      date,
      trainingLoad,
      plannedTrainingLoad: load(today.filter((w) => w.planned)),
      fitness,
      fatigue,
      form: fitness - fatigue,
      formZone: formZone(fitness - fatigue),
      withoutHeartRate: today.filter((w) => w.trainingLoad === null && !w.planned).length,
      settling: start === null && daysBetween(historyStart, date) < FITNESS_DAYS,
    });
  }
  return days;
}

/** How many days of a range were counted toward its Form Zones, and how many of them fell in each. */
export interface FormZoneCount {
  counted: number;
  days: Record<FormZone, number>;
}

/**
 * The days in each Form Zone. Settling days are left out, as their Fitness is still rising from zero, and so is a day
 * still counting Planned Training Load, whose Form is a forecast rather than progress.
 */
export function formZoneCount(days: FitnessDay[]): FormZoneCount {
  const count: FormZoneCount = { counted: 0, days: Object.fromEntries(FORM_ZONES.map((z) => [z, 0])) as Record<FormZone, number> };
  for (const d of days) {
    if (d.settling || d.plannedTrainingLoad > 0) continue;
    count.counted++;
    count.days[d.formZone]++;
  }
  return count;
}
