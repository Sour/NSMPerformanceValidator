import { isRun, matchActivities, type Activity, type PlannedWorkout } from "./matching";
import { addDays, dayOfWeek } from "./localDate";
import { runType, type RunType } from "./runType";

export interface TrainingWeek<A extends Activity = Activity> {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
  days: TrainingDay<A>[];
  /** Running Activities in the week with no Match. */
  unplannedRuns: A[];
}

export interface TrainingDay<A extends Activity = Activity> {
  date: string;
  workouts: WeekWorkout<A>[];
}

/** Missed once its day has passed; until then, Upcoming. */
export type WorkoutStatus = "Matched" | "Missed" | "Upcoming";

export interface WeekWorkout<A extends Activity = Activity> {
  plannedWorkout: PlannedWorkout;
  runType: RunType | null;
  status: WorkoutStatus;
  activity?: A;
}

/** The Monday starting the Training Week that contains `date`, a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/**
 * The Training Week (Monday to Sunday) containing `date`, by default `today`; both YYYY-MM-DD dates.
 * Planned Workouts without a Match are Missed before `today` and Upcoming from it.
 */
export function trainingWeek<A extends Activity>(
  today: string,
  planned: PlannedWorkout[],
  activities: A[],
  date = today,
): TrainingWeek<A> {
  const start = weekStart(date);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const matches = matchActivities(planned, activities);
  const activityFor = (p: PlannedWorkout) => {
    const match = matches.find((m) => m.plannedWorkoutId === p.id);
    return activities.find((a) => a.id === match?.activityId);
  };
  const end = dates[6]!;
  return {
    start,
    end,
    days: dates.map((date) => ({
      date,
      workouts: planned
        .filter((p) => p.date === date)
        .map((plannedWorkout) => {
          const typed = { plannedWorkout, runType: runType(plannedWorkout.name) };
          const activity = activityFor(plannedWorkout);
          if (activity) return { ...typed, status: "Matched", activity };
          return { ...typed, status: date < today ? "Missed" : "Upcoming" };
        }),
    })),
    unplannedRuns: activities.filter(
      (a) => isRun(a) && a.date >= start && a.date <= end && !matches.some((m) => m.activityId === a.id),
    ),
  };
}

/** The Mondays of the earliest and latest Training Weeks there is anything to show for. */
export interface TrainingWeekRange {
  earliest: string;
  latest: string;
}

/**
 * From the Training Week holding the first Planned Workout to the one holding the last, widened to include
 * the Training Week containing `today`.
 */
export function trainingWeekRange(today: string, planned: PlannedWorkout[]): TrainingWeekRange {
  const weeks = [today, ...planned.map((p) => p.date)].map(weekStart).sort();
  return { earliest: weeks[0]!, latest: weeks.at(-1)! };
}
