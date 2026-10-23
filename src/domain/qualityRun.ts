/** A Quality Run Format: `reps` × `repLength`. */
export interface QualityRunFormat {
  reps: number;
  /** The Rep Length, in seconds. */
  repLength: number;
}

/** One interval intervals.icu detected in an Activity. */
export interface DetectedInterval {
  /** intervals.icu's classification, e.g. "WORK" or "RECOVERY". */
  type: string;
  /** Seconds. */
  movingTime: number;
  /** Grade-adjusted speed, metres per second. */
  gap: number | null;
  averageHeartrate: number | null;
}

export interface QualityRun {
  format: QualityRunFormat;
  reps: DetectedInterval[];
  /** Every planned Rep was run. */
  complete: boolean;
  /** Rep GAP as a grade-adjusted speed in metres per second; null without Reps. */
  repGap: number | null;
  /** Rep HR in bpm; null without Reps or heart rate. */
  repHr: number | null;
  /** Efficiency in grade-adjusted metres per heartbeat; null without Reps that have both GAP and heart rate. */
  efficiency: number | null;
  /** At least one Rep's average heart rate exceeded the top of the planned heart-rate target. */
  overTarget: boolean;
}

/** A Quality Run's name leads with its Format, e.g. "4 x 6:00 at 163–177 bpm". */
const QUALITY_RUN_FORMAT = /^\s*(\d+)\s*[x×]\s*(\d+):(\d{2})/i;

/** A Planned Workout's name gives its heart-rate target, e.g. "at 163–177 bpm". */
const HEART_RATE_TARGET = /(\d+)\s*[–-]\s*(\d+)\s*bpm/i;

/** How far a work interval's duration may stray from the planned Rep Length and still be a Rep. */
const REP_LENGTH_TOLERANCE = 0.15;

/** The Quality Run Format a Planned Workout's name leads with; null when it is not a Quality Run. */
export function qualityRunFormat(plannedWorkoutName: string): QualityRunFormat | null {
  const match = QUALITY_RUN_FORMAT.exec(plannedWorkoutName);
  if (!match) return null;
  return { reps: Number(match[1]), repLength: Number(match[2]) * 60 + Number(match[3]) };
}

/** The top of the heart-rate target a Planned Workout's name gives, in bpm; null when it names none. */
export function heartRateCeiling(plannedWorkoutName: string): number | null {
  const match = HEART_RATE_TARGET.exec(plannedWorkoutName);
  return match ? Number(match[2]) : null;
}

/**
 * Picks the Reps out of an Activity's detected intervals, using the Planned Workout's Format as the template:
 * the work intervals within 15% of the Rep Length, in order, up to the planned rep count.
 * `hrCeiling` is the top of the Planned Workout's heart-rate target, for the Over Target check.
 */
export function qualityRun(
  format: QualityRunFormat,
  intervals: DetectedInterval[],
  hrCeiling: number | null,
): QualityRun {
  const reps = intervals
    .filter(
      (i) => i.type === "WORK" && Math.abs(i.movingTime - format.repLength) <= format.repLength * REP_LENGTH_TOLERANCE,
    )
    .slice(0, format.reps);
  return {
    format,
    reps,
    complete: reps.length === format.reps,
    repGap: timeWeightedMean(reps, (r) => r.gap),
    repHr: timeWeightedMean(reps, (r) => r.averageHeartrate),
    efficiency: efficiency(reps),
    overTarget: hrCeiling !== null && reps.some((r) => r.averageHeartrate !== null && r.averageHeartrate > hrCeiling),
  };
}

/** Grade-adjusted metres per heartbeat over the Reps that have both GAP and heart rate. */
function efficiency(reps: DetectedInterval[]): number | null {
  const measured = reps.filter((r) => r.gap !== null && r.averageHeartrate !== null);
  const gap = timeWeightedMean(measured, (r) => r.gap);
  const hr = timeWeightedMean(measured, (r) => r.averageHeartrate);
  return gap === null || hr === null || hr === 0 ? null : (gap * 60) / hr;
}

function timeWeightedMean(reps: DetectedInterval[], value: (r: DetectedInterval) => number | null): number | null {
  const measured = reps.filter((r) => value(r) !== null);
  const time = measured.reduce((sum, r) => sum + r.movingTime, 0);
  if (time === 0) return null;
  return measured.reduce((sum, r) => sum + value(r)! * r.movingTime, 0) / time;
}
