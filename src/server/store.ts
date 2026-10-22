import { asc, notInArray } from "drizzle-orm";
import { localDate } from "../domain/localDate";
import type { Activity, PlannedWorkout } from "../domain/matching";
import type { Db } from "./db";
import { activities, plannedWorkouts } from "./db/schema";
import type { IntervalsActivity, IntervalsEvent } from "./intervals";

export type StoredPlannedWorkout = PlannedWorkout & { raw: unknown };
export type StoredActivity = Activity & { distance: number | null; raw: unknown };

/** Makes the stored Planned Workouts and Activities exactly those given, keyed by intervals.icu id. */
export function replaceSyncedData(
  db: Db,
  events: IntervalsEvent[],
  runningActivities: IntervalsActivity[],
  syncedAt: string,
): void {
  db.transaction((tx) => {
    for (const e of events) {
      const row = {
        id: e.id,
        date: localDate(e.start_date_local),
        name: e.name,
        pairedActivityId: e.paired_activity_id ?? null,
        raw: e,
        syncedAt,
      };
      tx.insert(plannedWorkouts).values(row).onConflictDoUpdate({ target: plannedWorkouts.id, set: row }).run();
    }
    tx.delete(plannedWorkouts).where(notInArray(plannedWorkouts.id, events.map((e) => e.id))).run();

    for (const a of runningActivities) {
      const row = {
        id: a.id,
        date: localDate(a.start_date_local),
        type: a.type,
        name: a.name,
        movingTime: a.moving_time ?? 0,
        distance: a.distance ?? null,
        pairedEventId: a.paired_event_id ?? null,
        raw: a,
        syncedAt,
      };
      tx.insert(activities).values(row).onConflictDoUpdate({ target: activities.id, set: row }).run();
    }
    tx.delete(activities).where(notInArray(activities.id, runningActivities.map((a) => a.id))).run();
  });
}

export function loadPlannedWorkouts(db: Db): StoredPlannedWorkout[] {
  return db
    .select({
      id: plannedWorkouts.id,
      date: plannedWorkouts.date,
      name: plannedWorkouts.name,
      pairedActivityId: plannedWorkouts.pairedActivityId,
      raw: plannedWorkouts.raw,
    })
    .from(plannedWorkouts)
    .orderBy(asc(plannedWorkouts.date), asc(plannedWorkouts.id))
    .all();
}

export function loadActivities(db: Db): StoredActivity[] {
  return db
    .select({
      id: activities.id,
      date: activities.date,
      type: activities.type,
      name: activities.name,
      movingTime: activities.movingTime,
      distance: activities.distance,
      pairedEventId: activities.pairedEventId,
      raw: activities.raw,
    })
    .from(activities)
    .orderBy(asc(activities.date), asc(activities.id))
    .all();
}
