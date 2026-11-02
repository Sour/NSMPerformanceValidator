import type { ActivityStreams } from "./activityStreams";

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
  if (!streams || !hr || !hr.some(hasHeartRate) || lthr === null || maxHr === null || restingHr === null) return null;
  if (!(maxHr > restingHr && lthr > restingHr)) return null;
  const weight = (bpm: number) => {
    const reserve = Math.max(0, (bpm - restingHr) / (maxHr - restingHr));
    return reserve * TRIMP_SCALE * Math.exp(TRIMP_EXPONENT * reserve);
  };
  const { time, velocity } = streams;
  let trimp = 0;
  for (let i = 1; i < time.length; i++) {
    const bpm = hr[i];
    if (!hasHeartRate(bpm) || velocity?.[i] === 0) continue;
    trimp += (time[i]! - time[i - 1]!) * weight(bpm);
  }
  return (trimp / (3600 * weight(lthr))) * LOAD_PER_HOUR_AT_THRESHOLD;
}

/** A heart rate of 0 is a dropped sensor, not a recorded heart rate. */
function hasHeartRate(bpm: number | null | undefined): bpm is number {
  return bpm != null && bpm > 0;
}
