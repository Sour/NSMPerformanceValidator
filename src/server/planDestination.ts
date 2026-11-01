import type { EasyHrTarget } from "../domain/easyTrend";
import type { DatedDay } from "../domain/weekPlan";

/** What pushed workouts' heart-rate targets come from. */
export interface WorkoutTargets {
  /** LTHR in bpm, which a Quality Run names its Rep target by; null when none is known. */
  lthr: number | null;
  easyHrTarget: EasyHrTarget;
}

/** A Planned Workout the NSM app made, which a push replaces only once the runner confirms. */
export interface NsmAppWorkout {
  id: string;
  date: string;
  name: string;
}

/** What a push made of one day: its workout's id in the destination and its version then; both null for rest. */
export interface DayPushResult {
  date: string;
  eventId: string | null;
  version: string | null;
}

export type PlanDestinationResult =
  /** NSM-app workouts are on the days; nothing was changed. */
  | { outcome: "ConfirmReplace"; nsmAppWorkouts: NsmAppWorkout[] }
  | { outcome: "Pushed"; days: DayPushResult[]; replaced: NsmAppWorkout[] }
  /** The push stopped at an error; `days` were pushed before it. */
  | { outcome: "Failed"; days: DayPushResult[]; error: string };

/**
 * Where Week Plans are pushed to become Planned Workouts: intervals.icu today, perhaps Garmin later. The planner depends
 * only on this.
 */
export interface PlanDestination {
  /**
   * Brings the given days in line with the Week Plan: one workout of this app's per workout day, none on a rest day.
   * Only workouts this app made are changed, and only on these days. When NSM-app workouts are on them, nothing
   * changes and they are returned, unless `replaceNsmApp`, when they are deleted first.
   */
  push(request: { days: DatedDay[]; targets: WorkoutTargets; replaceNsmApp: boolean }): Promise<PlanDestinationResult>;
}

/** Without a destination, as in tests that do not push, every push fails. */
export const noDestination: PlanDestination = {
  push: async () => ({ outcome: "Failed", days: [], error: "Pushing is not available" }),
};
