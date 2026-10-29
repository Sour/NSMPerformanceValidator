import { isRun, matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { addDays } from "./localDate";
import { qualityRun, qualityRunFormat, type DetectedInterval } from "./qualityRun";
import { weekStart } from "./trainingWeek";

/**
 * An Activity with its distance in metres, null when the watch recorded none, and the intervals intervals.icu
 * detected in it, null until they have been fetched.
 */
export type VolumeActivity = Activity & { distance: number | null; intervals: DetectedInterval[] | null };

/** Running distance and time. */
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
  /** Rep Volume: the Reps of the week's Matched Quality Runs. */
  reps: Volume;
  /** Easy Volume: everything in `total` that is not Rep Volume. */
  easy: Volume;
  /** Rep Volume's moving time as a whole percentage of the week's; null for a week with no running. */
  repShare: number | null;
}

/**
 * Weekly Volume for every Training Week from the one holding the first Planned Workout through the one holding `today`,
 * oldest first, counting every running Activity. Activity dates are local, so weeks follow the athlete's time zone.
 * A Quality Run whose Reps are not identified, as when its intervals are not fetched, counts entirely as Easy Volume.
 */
export function weeklyVolume(today: string, planned: PlannedWorkout[], activities: VolumeActivity[]): VolumeWeek[] {
  const first = planned.map((p) => p.date).sort()[0];
  if (first === undefined) return [];
  const weeks: VolumeWeek[] = [];
  for (let start = weekStart(first); start <= today; start = addDays(start, 7)) {
    weeks.push({ start, end: addDays(start, 6), total: empty(), reps: empty(), easy: empty(), repShare: null });
  }

  const matches = matchActivities(planned, activities);
  /** An Activity's Rep Volume, never more than the Activity itself, so its Easy Volume is never negative. */
  const repVolume = (a: VolumeActivity, run: Volume): Volume => {
    const match = matches.find((m) => m.activityId === a.id);
    const plannedWorkout = planned.find((p) => p.id === match?.plannedWorkoutId);
    const format = plannedWorkout && qualityRunFormat(plannedWorkout.name);
    if (!format || !a.intervals) return empty();
    const reps = qualityRun(format, a.intervals, null).reps.reduce(
      (sum, r) => add(sum, { distance: r.distance ?? 0, movingTime: r.movingTime }),
      empty(),
    );
    return { distance: Math.min(reps.distance, run.distance), movingTime: Math.min(reps.movingTime, run.movingTime) };
  };
  for (const a of activities.filter(isRun)) {
    const week = weeks.find((w) => a.date >= w.start && a.date <= w.end);
    if (!week) continue;
    const run = { distance: a.distance ?? 0, movingTime: a.movingTime };
    const reps = repVolume(a, run);
    add(week.total, run);
    add(week.reps, reps);
    add(week.easy, { distance: run.distance - reps.distance, movingTime: run.movingTime - reps.movingTime });
  }
  for (const week of weeks) {
    week.repShare = week.total.movingTime > 0 ? Math.round((week.reps.movingTime / week.total.movingTime) * 100) : null;
  }
  return weeks;
}

function empty(): Volume {
  return { distance: 0, movingTime: 0 };
}

function add(volume: Volume, more: Volume): Volume {
  volume.distance += more.distance;
  volume.movingTime += more.movingTime;
  return volume;
}
