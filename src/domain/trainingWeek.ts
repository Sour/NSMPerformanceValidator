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

/** The Training Week (Monday to Sunday) containing `today`, a YYYY-MM-DD date. */
export function trainingWeek<A extends Activity>(
  today: string,
  planned: PlannedWorkout[],
  activities: A[],
): TrainingWeek<A> {
  const start = addDays(today, -((dayOfWeek(today) + 6) % 7));
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
