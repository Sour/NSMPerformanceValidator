import { matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { runType, type RunType } from "./runType";

/** A run's whole-run averages; each null when the watch recorded none. */
export interface EasyAverages {
  /** Easy GAP as a grade-adjusted speed in metres per second. */
  easyGap: number | null;
  /** Easy HR, the average heart rate. */
  easyHr: number | null;
}

export type EasyActivity = Activity & EasyAverages;

export type EasyRunType = Extract<RunType, "Easy Run" | "Long Run">;

/** One point of the Easy GAP / Easy HR trend. */
export interface EasyTrendRun extends EasyAverages {
  activityId: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  runType: EasyRunType;
  /** Easy Efficiency in grade-adjusted metres per heartbeat; null without both Easy GAP and Easy HR. */
  easyEfficiency: number | null;
}

/** Every Activity Matched to an Easy Run or Long Run, oldest first; Unplanned Runs have no Run Type, so none appear. */
export function easyTrend(planned: PlannedWorkout[], activities: EasyActivity[]): EasyTrendRun[] {
  return matchActivities(planned, activities)
    .flatMap((m) => {
      const type = runType(planned.find((p) => p.id === m.plannedWorkoutId)!.name);
      const a = activities.find((candidate) => candidate.id === m.activityId)!;
      if (type !== "Easy Run" && type !== "Long Run") return [];
      return [
        {
          activityId: a.id,
          date: a.date,
          name: a.name,
          runType: type,
          easyGap: a.easyGap,
          easyHr: a.easyHr,
          easyEfficiency: easyEfficiency(a),
        },
      ];
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** Grade-adjusted metres per heartbeat over the whole run. */
function easyEfficiency({ easyGap, easyHr }: EasyAverages): number | null {
  return easyGap === null || easyHr === null || easyHr === 0 ? null : (easyGap * 60) / easyHr;
}
