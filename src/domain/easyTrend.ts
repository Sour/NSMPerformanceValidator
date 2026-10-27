import { shareAbove, walkBreakTime, type ActivityStreams } from "./activityStreams";
import { addDays, daysBetween } from "./localDate";
import { matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { secondsPerMile } from "./pace";
import { runType, type RunType } from "./runType";
import { weekStart } from "./trainingWeek";

/** A run's whole-run averages; each null when the watch recorded none. */
export interface EasyAverages {
  /** Easy GAP as a grade-adjusted speed in metres per second. */
  easyGap: number | null;
  /** Easy HR, the average heart rate. */
  easyHr: number | null;
}

/** `streams` is null when they were not fetched. */
export type EasyActivity = Activity & EasyAverages & { streams: ActivityStreams | null };

/** An Easy HR Target: a heart-rate window as percentages of Max HR, e.g. 62–70. */
export interface EasyHrTarget {
  low: number;
  high: number;
}

/** A Planned Workout with its Easy HR Target; null when it names none. */
export type EasyPlannedWorkout = PlannedWorkout & { easyHrTarget: EasyHrTarget | null };

export type EasyRunType = Extract<RunType, "Easy Run" | "Long Run">;

/** One point of the Easy Pace trend. */
export interface EasyTrendRun extends EasyAverages {
  activityId: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  runType: EasyRunType;
  /** Easy Pace as a grade-adjusted speed in metres per second; null without Easy GAP, Easy HR or a reference HR. */
  easyPace: number | null;
  /** Seconds walked in Walk Breaks; null without a cadence stream. */
  walkBreakTime: number | null;
  /** The top of the run's Easy HR Target in bpm; null without Max HR or an Easy HR Target. */
  easyHrTargetTop: number | null;
  /** The share of moving time above `easyHrTargetTop`, 0 to 1; null without it or a heart-rate stream. */
  timeAboveTarget: number | null;
  /** More than 10% of moving time above `easyHrTargetTop`; the run still counts toward the trend. */
  overTarget: boolean;
  /** A Grey Zone Run: more than 25% of moving time above `easyHrTargetTop`. It does not count toward the trend. */
  greyZone: boolean;
}

/** One Run Type's Easy Pace trend over the last 6 Training Weeks. */
export interface EasyPaceTrend {
  /** The Monday starting the window, YYYY-MM-DD. */
  from: string;
  /** Today, the window's end, YYYY-MM-DD. */
  to: string;
  /**
   * The Easy Pace, in metres per second, that a straight line fitted by least squares to the window's runs gives at
   * `from` and at `to`; null, Not enough data, with fewer than 3 runs.
   */
  line: { start: number; end: number } | null;
  /** Grey Zone Runs in the window, left out of the line. */
  greyZoneRuns: number;
}

export interface EasyTrend {
  /**
   * The heart rate every Easy Pace is scaled to, in bpm: the middle of the current Easy HR Target.
   * Null, so Easy Pace cannot be computed, without Max HR or an Easy HR Target.
   */
  referenceHr: number | null;
  /** Every Matched Easy Run and Long Run, oldest first. */
  runs: EasyTrendRun[];
  trends: Record<EasyRunType, EasyPaceTrend>;
}

/** Training Weeks before this one that the trend also reads. */
const TREND_WEEKS_BEFORE = 5;

/** The fewest runs of a Run Type its trend line needs. */
const MIN_TREND_RUNS = 3;

/** Over Target past this share of moving time above the top of the Easy HR Target. */
const OVER_TARGET_SHARE = 0.1;

/** A Grey Zone Run past this share of moving time above the top of the Easy HR Target. */
const GREY_ZONE_SHARE = 0.25;

/**
 * Every Activity Matched to an Easy Run or Long Run with its Easy Pace, oldest first; Unplanned Runs have no Run Type,
 * so none appear. Every run, past ones included, is scaled to today's Easy HR Target and `maxHr`.
 */
export function easyTrend(planned: EasyPlannedWorkout[], activities: EasyActivity[], today: string, maxHr: number | null): EasyTrend {
  const target = currentEasyHrTarget(planned, today);
  const referenceHr = maxHr === null || target === null ? null : (maxHr * (target.low + target.high)) / 2 / 100;
  const runs = matchActivities(planned, activities)
    .flatMap((m) => {
      const p = planned.find((candidate) => candidate.id === m.plannedWorkoutId)!;
      const type = runType(p.name);
      const a = activities.find((candidate) => candidate.id === m.activityId)!;
      if (!isEasyRunType(type)) return [];
      const runTarget = p.easyHrTarget ?? target;
      const easyHrTargetTop = maxHr === null || runTarget === null ? null : (maxHr * runTarget.high) / 100;
      const above = a.streams === null || easyHrTargetTop === null ? null : shareAbove(a.streams, easyHrTargetTop);
      return [
        {
          activityId: a.id,
          date: a.date,
          name: a.name,
          runType: type,
          easyGap: a.easyGap,
          easyHr: a.easyHr,
          easyPace: easyPace(a, referenceHr),
          walkBreakTime: a.streams === null ? null : walkBreakTime(a.streams),
          easyHrTargetTop,
          timeAboveTarget: above,
          overTarget: above !== null && above > OVER_TARGET_SHARE,
          greyZone: above !== null && above > GREY_ZONE_SHARE,
        },
      ];
    })
    .sort((x, y) => x.date.localeCompare(y.date));
  const from = addDays(weekStart(today), -7 * TREND_WEEKS_BEFORE);
  const trend = (type: EasyRunType) => paceTrend(runs.filter((r) => r.runType === type), from, today);
  return { referenceHr, runs, trends: { "Easy Run": trend("Easy Run"), "Long Run": trend("Long Run") } };
}

/**
 * The trend of `runs` from `from` through `to`, fitted in seconds per mile, the way pace is charted.
 * Runs before `from` and Grey Zone Runs do not count.
 */
function paceTrend(runs: EasyTrendRun[], from: string, to: string): EasyPaceTrend {
  const inWindow = runs.filter((r) => r.date >= from && r.date <= to);
  const greyZoneRuns = inWindow.filter((r) => r.greyZone).length;
  const points = inWindow
    .filter((r) => !r.greyZone && r.easyPace !== null)
    .map((r) => ({ day: daysBetween(from, r.date), pace: secondsPerMile(r.easyPace!) }));
  const line = points.length < MIN_TREND_RUNS ? null : leastSquares(points);
  if (line === null) return { from, to, line: null, greyZoneRuns };
  // Seconds per mile and metres per second convert the same way in both directions.
  const at = (day: number) => secondsPerMile(line.intercept + line.slope * day);
  return { from, to, line: { start: at(0), end: at(daysBetween(from, to)) }, greyZoneRuns };
}

function leastSquares(points: { day: number; pace: number }[]): { intercept: number; slope: number } | null {
  const n = points.length;
  const meanDay = points.reduce((sum, p) => sum + p.day, 0) / n;
  const meanPace = points.reduce((sum, p) => sum + p.pace, 0) / n;
  const spread = points.reduce((sum, p) => sum + (p.day - meanDay) ** 2, 0);
  if (spread === 0) return null;
  const slope = points.reduce((sum, p) => sum + (p.day - meanDay) * (p.pace - meanPace), 0) / spread;
  return { intercept: meanPace - slope * meanDay, slope };
}

/** The Easy HR Target of the most recent Easy Run or Long Run planned on or before `today`; null when none names one. */
export function currentEasyHrTarget(planned: EasyPlannedWorkout[], today: string): EasyHrTarget | null {
  const latest = planned
    .filter((p) => p.date <= today && p.easyHrTarget !== null && isEasyRunType(runType(p.name)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return latest?.easyHrTarget ?? null;
}

function isEasyRunType(type: RunType | null): type is EasyRunType {
  return type === "Easy Run" || type === "Long Run";
}

/** Easy GAP scaled to `referenceHr`, assuming grade-adjusted speed rises in proportion to heart rate. */
function easyPace({ easyGap, easyHr }: EasyAverages, referenceHr: number | null): number | null {
  return easyGap === null || easyHr === null || easyHr === 0 || referenceHr === null ? null : (easyGap * referenceHr) / easyHr;
}
