import { isRun, matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { addDays } from "./localDate";
import { runType, type RunType } from "./runType";
import { weekStart } from "./trainingWeek";

/** An Activity with its distance in metres; null when the watch recorded none. */
export type VolumeActivity = Activity & { distance: number | null };

/** What Weekly Volume is stacked by: the Run Type of an Activity's Match, or Unplanned Run. */
export type VolumeCategory = RunType | "Unplanned Run";

export const VOLUME_CATEGORIES: readonly VolumeCategory[] = ["Quality Run", "Easy Run", "Long Run", "Unplanned Run"];

export interface Volume {
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
}

export interface VolumeWeek {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
  total: Volume;
  byRunType: Record<VolumeCategory, Volume>;
}

/**
 * Weekly Volume for every Training Week from the one holding the first Planned Workout through the one holding `today`,
 * oldest first, counting every running Activity. Activity dates are local, so weeks follow the athlete's time zone.
 * An Activity Matched to a Planned Workout with no Run Type counts with the Unplanned Runs, as neither has a Run Type.
 */
export function weeklyVolume(today: string, planned: PlannedWorkout[], activities: VolumeActivity[]): VolumeWeek[] {
  const first = planned.map((p) => p.date).sort()[0];
  if (first === undefined) return [];
  const weeks: VolumeWeek[] = [];
  for (let start = weekStart(first); start <= today; start = addDays(start, 7)) {
    const byRunType = Object.fromEntries(VOLUME_CATEGORIES.map((c) => [c, empty()])) as Record<VolumeCategory, Volume>;
    weeks.push({ start, end: addDays(start, 6), total: empty(), byRunType });
  }

  const matches = matchActivities(planned, activities);
  for (const a of activities.filter(isRun)) {
    const week = weeks.find((w) => a.date >= w.start && a.date <= w.end);
    if (!week) continue;
    const match = matches.find((m) => m.activityId === a.id);
    const plannedWorkout = planned.find((p) => p.id === match?.plannedWorkoutId);
    const category = (plannedWorkout && runType(plannedWorkout.name)) ?? "Unplanned Run";
    add(week.byRunType[category], a);
    add(week.total, a);
  }
  return weeks;
}

function empty(): Volume {
  return { distance: 0, movingTime: 0 };
}

function add(volume: Volume, a: VolumeActivity): void {
  volume.distance += a.distance ?? 0;
  volume.movingTime += a.movingTime;
}
