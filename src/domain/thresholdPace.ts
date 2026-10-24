import { addDays } from "./localDate";
import type { PlannedWorkout } from "./matching";
import { heartRateTarget, qualityRunFormat } from "./qualityRun";

/** A Quality Run's Rep GAP and Rep HR, the points it adds to the pace line. */
export interface QualityPoint {
  date: string;
  complete: boolean;
  /** Metres per second; null without Reps. */
  repGap: number | null;
  repHr: number | null;
}

/** An Easy Run's or Long Run's Easy GAP and Easy HR. */
export interface EasyPoint {
  date: string;
  /** Metres per second. */
  easyGap: number | null;
  easyHr: number | null;
}

/** Grade-adjusted speed in metres per second as a straight line in heart rate: `intercept + slope × hr`. */
export interface PaceLine {
  intercept: number;
  slope: number;
}

/** A Rep's heart-rate target is 90–98% of LTHR. */
const TARGET_LOW = 0.9;
const TARGET_HIGH = 0.98;

/** Training Weeks before the one a pace line is for that it also reads. */
const WINDOW_WEEKS_BEFORE = 5;

/** The fewest Complete Quality Runs, and the fewest Easy Runs and Long Runs, a pace line needs. */
const MIN_RUNS_EACH = 2;

/**
 * The current LTHR, read from the heart-rate target of the most recent Quality Run planned on or before `today`:
 * the average of what each end of the 90–98% target gives. Null when no Quality Run names a target.
 */
export function lthr(planned: PlannedWorkout[], today: string): number | null {
  const latest = planned
    .filter((p) => p.date <= today && qualityRunFormat(p.name) && heartRateTarget(p.name))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (!latest) return null;
  const { low, high } = heartRateTarget(latest.name)!;
  return (low / TARGET_LOW + high / TARGET_HIGH) / 2;
}

/**
 * The pace-versus-heart-rate line for the Training Week starting `week` (a Monday), fitted by least squares
 * to Complete Quality Runs and Easy Runs and Long Runs in that week and the five before it.
 * Null, Not enough data, with fewer than two of either kind or when pace does not get faster as heart rate rises.
 */
export function paceLine(week: string, quality: QualityPoint[], easy: EasyPoint[]): PaceLine | null {
  const from = addDays(week, -7 * WINDOW_WEEKS_BEFORE);
  const to = addDays(week, 6);
  const inWindow = (date: string) => date >= from && date <= to;
  const repPoints = quality
    .filter((q) => q.complete && inWindow(q.date) && q.repGap !== null && q.repHr !== null)
    .map((q) => ({ hr: q.repHr!, gap: q.repGap! }));
  const easyPoints = easy
    .filter((e) => inWindow(e.date) && e.easyGap !== null && e.easyHr !== null)
    .map((e) => ({ hr: e.easyHr!, gap: e.easyGap! }));
  if (repPoints.length < MIN_RUNS_EACH || easyPoints.length < MIN_RUNS_EACH) return null;
  const line = leastSquares([...repPoints, ...easyPoints]);
  return line && line.slope > 0 ? line : null;
}

/** The grade-adjusted speed, in metres per second, `line` gives at heart rate `hr`. */
export function paceAt(line: PaceLine, hr: number): number {
  return line.intercept + line.slope * hr;
}

function leastSquares(points: { hr: number; gap: number }[]): PaceLine | null {
  const n = points.length;
  const meanHr = points.reduce((sum, p) => sum + p.hr, 0) / n;
  const meanGap = points.reduce((sum, p) => sum + p.gap, 0) / n;
  const spread = points.reduce((sum, p) => sum + (p.hr - meanHr) ** 2, 0);
  if (spread === 0) return null;
  const slope = points.reduce((sum, p) => sum + (p.hr - meanHr) * (p.gap - meanGap), 0) / spread;
  return { intercept: meanGap - slope * meanHr, slope };
}
