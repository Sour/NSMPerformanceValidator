import type { ActivityStreams } from "./activityStreams";
import type { EasyHrTarget } from "./easyTrend";

/** What intervals.icu recorded with a workout to score it against; each null when not recorded. */
export interface RecordedThresholds {
  /** In bpm. */
  lthr: number | null;
  /** In bpm. */
  maxHr: number | null;
  /** In bpm. */
  restingHr: number | null;
  /** In metres per second. */
  thresholdPace: number | null;
}

/** An Activity or Cross-Training workout as far as its Training Load goes. */
export interface LoadedWorkout {
  /** A running Activity, scored by Pace Load first; Cross-Training is scored by HR Load only. */
  running: boolean;
  /** In seconds. */
  movingTime: number;
  /** Its average GAP in metres per second; null when not recorded. */
  gap: number | null;
  thresholds: RecordedThresholds;
  streams: Pick<ActivityStreams, "time" | "heartrate" | "velocity"> | null;
}

/** An hour at Threshold Pace, or at LTHR, is 100. */
const LOAD_PER_HOUR_AT_THRESHOLD = 100;

/** Banister's TRIMP weighting: a heart rate reserve fraction `x` counts x · 0.64 · e^(1.92 x). */
const TRIMP_SCALE = 0.64;
const TRIMP_EXPONENT = 1.92;

/**
 * A workout's Training Load, as the athlete's intervals.icu Sport Settings give it: a running Activity's Pace Load when
 * it has a GAP and a Threshold Pace, otherwise its HR Load. Rounded to a whole number, as intervals.icu does. Null when
 * it has neither, as without heart rate or the thresholds recorded with it.
 */
export function trainingLoad(workout: LoadedWorkout): number | null {
  const load = (workout.running ? paceLoad(workout) : null) ?? hrLoad(workout);
  return load === null ? null : Math.round(load);
}

/** Moving time in hours × (GAP ÷ Threshold Pace)² × 100. Null without moving time, a GAP or a Threshold Pace. */
function paceLoad({ movingTime, gap, thresholds: { thresholdPace } }: LoadedWorkout): number | null {
  if (!(movingTime > 0) || gap === null || thresholdPace === null) return null;
  return (movingTime / 3600) * (gap / thresholdPace) ** 2 * LOAD_PER_HOUR_AT_THRESHOLD;
}

/**
 * HRSS: Banister's TRIMP summed over the samples, against that of an hour at LTHR, which is 100. Each sample from the
 * second on counts for the time since the one before, long gaps included. Samples without heart rate add nothing, nor
 * do stopped ones (speed 0) when there is a speed stream. Null without heart rate, or without LTHR, Max HR and resting
 * HR recorded.
 */
function hrLoad({ streams, thresholds: { lthr, maxHr, restingHr } }: LoadedWorkout): number | null {
  const hr = streams?.heartrate;
  if (!streams || !hr || !hr.some(hasHeartRate)) return null;
  const weight = trimpWeight({ lthr, maxHr, restingHr });
  if (weight === null) return null;
  const { time, velocity } = streams;
  let trimp = 0;
  for (let i = 1; i < time.length; i++) {
    const bpm = hr[i];
    if (!hasHeartRate(bpm) || velocity?.[i] === 0) continue;
    trimp += (time[i]! - time[i - 1]!) * weight(bpm);
  }
  return hrssOf(trimp, weight, lthr!);
}

/** Banister's TRIMP weight of a heart rate between resting HR and Max HR; null without all three thresholds in order. */
function trimpWeight({ lthr, maxHr, restingHr }: CurrentThresholds): ((bpm: number) => number) | null {
  if (lthr === null || maxHr === null || restingHr === null || !(maxHr > restingHr && lthr > restingHr)) return null;
  return (bpm) => {
    const reserve = Math.max(0, (bpm - restingHr) / (maxHr - restingHr));
    return reserve * TRIMP_SCALE * Math.exp(TRIMP_EXPONENT * reserve);
  };
}

/** TRIMP summed over seconds, against that of an hour at LTHR, which is 100. */
function hrssOf(trimp: number, weight: (bpm: number) => number, lthr: number): number {
  return (trimp / (3600 * weight(lthr))) * LOAD_PER_HOUR_AT_THRESHOLD;
}

/** A Planned Workout's heart-rate target: `%hr` of Max HR, `%lthr` of LTHR, or `bpm` as given. */
export interface PlannedHrTarget {
  low: number;
  high: number;
  units: "%hr" | "%lthr" | "bpm";
}

/** A step of a Planned Workout, or a group of steps repeated `reps` times. */
export type PlannedStep =
  | { kind: "step"; /** In seconds; null when not given in time. */ duration: number | null; target: PlannedHrTarget | null }
  | { kind: "repeat"; reps: number; steps: PlannedStep[] };

/** The thresholds a Planned Workout is scored against: the runner's current ones. */
export type CurrentThresholds = Omit<RecordedThresholds, "thresholdPace">;

/**
 * A Planned Workout's Planned Training Load: its HR Load as if each step were run for its duration at the midpoint of
 * its heart-rate target, a step without one at the midpoint of the Easy HR Target (% of Max HR), and a repeat group's
 * steps once per repeat. Rounded to a whole number like Training Load. Null when it cannot be worked out: no steps, a
 * step without a duration, an untargeted step without an Easy HR Target, or thresholds missing.
 */
export function plannedTrainingLoad(
  steps: PlannedStep[],
  thresholds: CurrentThresholds,
  easyHrTarget: EasyHrTarget | null,
): number | null {
  const weight = trimpWeight(thresholds);
  const { lthr, maxHr } = thresholds;
  if (weight === null || steps.length === 0) return null;
  const bpm = ({ low, high, units }: PlannedHrTarget) => {
    const midpoint = (low + high) / 2;
    return units === "bpm" ? midpoint : (midpoint / 100) * (units === "%hr" ? maxHr! : lthr!);
  };
  const easy: PlannedHrTarget | null = easyHrTarget && { ...easyHrTarget, units: "%hr" };
  const trimpOf = (some: PlannedStep[]): number | null => {
    let trimp = 0;
    for (const s of some) {
      if (s.kind === "repeat") {
        const repeated = trimpOf(s.steps);
        if (repeated === null) return null;
        trimp += repeated * s.reps;
        continue;
      }
      const target = s.target ?? easy;
      if (s.duration === null || target === null) return null;
      trimp += s.duration * weight(bpm(target));
    }
    return trimp;
  };
  const trimp = trimpOf(steps);
  return trimp === null ? null : Math.round(hrssOf(trimp, weight, lthr!));
}

/** A heart rate of 0 is a dropped sensor, not a recorded heart rate. */
function hasHeartRate(bpm: number | null | undefined): bpm is number {
  return bpm != null && bpm > 0;
}
