import { matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { qualityRun, qualityRunFormat, type DetectedInterval, type QualityRunFormat } from "./qualityRun";

/** An Activity with the intervals intervals.icu detected in it; null until they have been fetched. */
export type AnalysedActivity = Activity & { intervals: DetectedInterval[] | null };

/** One Matched Quality Run on a Rep Length card. */
export interface RepLengthRun {
  date: string;
  activityId: string;
  plannedWorkoutName: string;
  format: QualityRunFormat;
  complete: boolean;
  repsRun: number;
  /** Rep GAP as a grade-adjusted speed in metres per second; null without Reps. */
  repGap: number | null;
  repHr: number | null;
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
export function repLengthCards(planned: PlannedWorkout[], activities: AnalysedActivity[]): RepLengthCard[] {
  const matches = matchActivities(planned, activities);
  const runs: RepLengthRun[] = [];
  for (const p of planned) {
    const format = qualityRunFormat(p.name);
    const activityId = matches.find((m) => m.plannedWorkoutId === p.id)?.activityId;
    const intervals = activities.find((a) => a.id === activityId)?.intervals;
    if (!format || !activityId || !intervals) continue;
    const run = qualityRun(format, intervals);
    runs.push({
      date: p.date,
      activityId,
      plannedWorkoutName: p.name,
      format,
      complete: run.complete,
      repsRun: run.reps.length,
      repGap: run.repGap,
      repHr: run.repHr,
    });
  }
  runs.sort((a, b) => a.date.localeCompare(b.date));

  const repLengths = new Set(planned.map((p) => qualityRunFormat(p.name)?.repLength).filter((l) => l !== undefined));
  return [...repLengths]
    .sort((a, b) => b - a)
    .map((repLength) => {
      const ofLength = runs.filter((r) => r.format.repLength === repLength);
      const trend = ofLength.filter((r) => r.complete && r.repGap !== null);
      return { repLength, runs: ofLength, latest: trend.at(-1) ?? null, previous: trend.at(-2) ?? null };
    });
}
