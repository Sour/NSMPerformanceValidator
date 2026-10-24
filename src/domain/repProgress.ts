import { matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { aboveCeiling, heartRateCeiling, qualityRun, qualityRunFormat, type DetectedInterval, type QualityRunFormat } from "./qualityRun";

/** An Activity with the intervals intervals.icu detected in it; null until they have been fetched. */
export type AnalysedActivity = Activity & { intervals: DetectedInterval[] | null };

/** A Planned Workout with the recovery between its Reps, in seconds, read from its structure; null when it has none. */
export type AnalysedPlannedWorkout = PlannedWorkout & { recovery: number | null };

/** One Matched Quality Run on a Rep Length card. */
export interface RepLengthRun {
  date: string;
  activityId: string;
  plannedWorkoutName: string;
  format: QualityRunFormat;
  complete: boolean;
  repsRun: number;
  /**
   * Each Rep found, in Rep order. An Incomplete run's missing Reps may have fallen anywhere among them,
   * since a Rep cut short is not told apart from any other work interval.
   */
  reps: RepDetail[];
  /** Rep GAP as a grade-adjusted speed in metres per second; null without Reps. */
  repGap: number | null;
  repHr: number | null;
  /** Efficiency in grade-adjusted metres per heartbeat; null without Reps that have both GAP and heart rate. */
  efficiency: number | null;
  /** The top of the Planned Workout's heart-rate target in bpm; null when it names none. */
  hrCeiling: number | null;
  /** A Rep's average heart rate exceeded `hrCeiling`. Over Target runs still count toward the trend. */
  overTarget: boolean;
  /** Planned seconds of recovery between Reps; null when the Planned Workout does not say. */
  recovery: number | null;
  /** How this run's rep count or recovery changed from the previous run with this Rep Length; null when neither did. */
  formatChange: FormatChange | null;
}

/** One Rep of a Quality Run. */
export interface RepDetail {
  /** Grade-adjusted speed in metres per second; null without GAP. */
  gap: number | null;
  /** Average heart rate in bpm; null without heart rate. */
  hr: number | null;
  /** The Rep's average heart rate exceeded the run's `hrCeiling`; any such Rep makes the run Over Target. */
  aboveCeiling: boolean;
}

/** What changed from the previous run with the same Rep Length: each field is the previous value, or null if unchanged. */
export interface FormatChange {
  reps: number | null;
  recovery: number | null;
}

export interface RepLengthCard {
  /** Seconds. */
  repLength: number;
  /** Every Matched Quality Run with this Rep Length, oldest first. */
  runs: RepLengthRun[];
  /** The latest Complete Quality Run with a Rep GAP. */
  latest: RepLengthRun | null;
  /** The one before `latest`. */
  previous: RepLengthRun | null;
}

/** One card per Rep Length in the plan, longest first, tracking every Matched Quality Run with that Rep Length. */
export function repLengthCards(planned: AnalysedPlannedWorkout[], activities: AnalysedActivity[]): RepLengthCard[] {
  const matches = matchActivities(planned, activities);
  const runs: RepLengthRun[] = [];
  for (const p of planned) {
    const format = qualityRunFormat(p.name);
    const activityId = matches.find((m) => m.plannedWorkoutId === p.id)?.activityId;
    const intervals = activities.find((a) => a.id === activityId)?.intervals;
    if (!format || !activityId || !intervals) continue;
    const hrCeiling = heartRateCeiling(p.name);
    const run = qualityRun(format, intervals, hrCeiling);
    runs.push({
      date: p.date,
      activityId,
      plannedWorkoutName: p.name,
      format,
      complete: run.complete,
      repsRun: run.reps.length,
      reps: run.reps.map((r) => ({ gap: r.gap, hr: r.averageHeartrate, aboveCeiling: aboveCeiling(r, hrCeiling) })),
      repGap: run.repGap,
      repHr: run.repHr,
      efficiency: run.efficiency,
      hrCeiling,
      overTarget: run.overTarget,
      recovery: p.recovery,
      formatChange: null,
    });
  }
  runs.sort((a, b) => a.date.localeCompare(b.date));

  const repLengths = new Set(planned.map((p) => qualityRunFormat(p.name)?.repLength).filter((l) => l !== undefined));
  return [...repLengths]
    .sort((a, b) => b - a)
    .map((repLength) => {
      const ofLength = runs
        .filter((r) => r.format.repLength === repLength)
        .map((run, i, all) => ({ ...run, formatChange: formatChange(all[i - 1], run) }));
      const trend = ofLength.filter((r) => r.complete && r.repGap !== null);
      return { repLength, runs: ofLength, latest: trend.at(-1) ?? null, previous: trend.at(-2) ?? null };
    });
}

/** How `run` changed rep count or recovery from `previous`; a recovery that is unknown on either side is not a change. */
function formatChange(previous: RepLengthRun | undefined, run: RepLengthRun): FormatChange | null {
  if (!previous) return null;
  const repsChanged = previous.format.reps !== run.format.reps;
  const recoveryChanged = previous.recovery !== null && run.recovery !== null && previous.recovery !== run.recovery;
  if (!repsChanged && !recoveryChanged) return null;
  return { reps: repsChanged ? previous.format.reps : null, recovery: recoveryChanged ? previous.recovery : null };
}
