import { matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { runType, type RunType } from "./runType";

/** An Activity with its whole-run averages; each null when the watch recorded none. */
export type EasyActivity = Activity & {
  /** Grade-adjusted speed in metres per second. */
  gap: number | null;
  averageHeartrate: number | null;
};

export type EasyRunType = Extract<RunType, "Easy Run" | "Long Run">;

/** One point of the Easy GAP / Easy HR trend. */
export interface EasyTrendRun {
  activityId: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  runType: EasyRunType;
  /** Easy GAP as a grade-adjusted speed in metres per second. */
  gap: number | null;
  /** Easy HR. */
  averageHeartrate: number | null;
}

/** Every Activity Matched to an Easy Run or Long Run, oldest first; Unplanned Runs have no Run Type, so none appear. */
export function easyTrend(planned: PlannedWorkout[], activities: EasyActivity[]): EasyTrendRun[] {
  return matchActivities(planned, activities)
    .flatMap((m) => {
      const type = runType(planned.find((p) => p.id === m.plannedWorkoutId)!.name);
      const a = activities.find((a) => a.id === m.activityId)!;
      if (type !== "Easy Run" && type !== "Long Run") return [];
      return [{ activityId: a.id, date: a.date, name: a.name, runType: type, gap: a.gap, averageHeartrate: a.averageHeartrate }];
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}
