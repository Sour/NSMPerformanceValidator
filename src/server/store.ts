import { and, asc, between, eq, notInArray } from "drizzle-orm";
import type { Activity, PlannedWorkout } from "../domain/matching";
import type { Db } from "./db";
import { activities, plannedWorkouts, syncStatus } from "./db/schema";
import { toActivity, toPlannedWorkout, type IntervalsActivity, type IntervalsEvent } from "./intervals";

export type StoredPlannedWorkout = PlannedWorkout & { raw: unknown };
/** `intervals` is intervals.icu's detected intervals response, or null when it was not fetched. */
export type StoredActivity = Activity & { distance: number | null; raw: unknown; intervals: unknown };

export type SyncStatus = Omit<typeof syncStatus.$inferSelect, "id">;

/** Inclusive YYYY-MM-DD dates bounding what one sync fetched. */
export interface SyncWindow {
  from: string;
  to: string;
}

/** A successful sync that stored data: when it finished, and the local date it synced through. */
export interface SyncedData {
  finishedAt: string;
  syncedThrough: string;
}

/**
 * Makes the stored Planned Workouts and Activities dated within `window` exactly those given,
 * keyed by intervals.icu id, and records the sync as successful.
 * `intervals` holds the detected intervals responses fetched for some of the Activities, by Activity id.
 */
export function saveSync(
  db: Db,
  window: SyncWindow,
  events: IntervalsEvent[],
  runningActivities: IntervalsActivity[],
  intervals: ReadonlyMap<string, unknown>,
  { finishedAt, syncedThrough }: SyncedData,
): void {
  db.transaction((tx) => {
    for (const e of events) {
      const row = { ...toPlannedWorkout(e), raw: e, syncedAt: finishedAt };
      tx.insert(plannedWorkouts).values(row).onConflictDoUpdate({ target: plannedWorkouts.id, set: row }).run();
    }
    tx.delete(plannedWorkouts)
      .where(
        and(
          between(plannedWorkouts.date, window.from, window.to),
          notInArray(plannedWorkouts.id, events.map((e) => e.id)),
        ),
      )
      .run();

    for (const a of runningActivities) {
      const row = {
        ...toActivity(a),
        distance: a.distance ?? null,
        raw: a,
        intervals: intervals.get(a.id) ?? null,
        syncedAt: finishedAt,
      };
      tx.insert(activities).values(row).onConflictDoUpdate({ target: activities.id, set: row }).run();
    }
    tx.delete(activities)
      .where(
        and(
          between(activities.date, window.from, window.to),
          notInArray(activities.id, runningActivities.map((a) => a.id)),
        ),
      )
      .run();

    writeSyncStatus(tx, { finishedAt, error: null, succeededAt: finishedAt, syncedThrough });
  });
}

/** Records a sync that failed with `error`, keeping what the last successful one did. */
export function recordSyncFailure(db: Db, finishedAt: string, error: string): void {
  const last = loadSyncStatus(db);
  writeSyncStatus(db, {
    finishedAt,
    error,
    succeededAt: last?.succeededAt ?? null,
    syncedThrough: last?.syncedThrough ?? null,
  });
}

/** Records a successful sync that had nothing to store, because no Planned Workout is tagged [NSM] yet. */
export function recordSyncWithNothingToStore(db: Db, finishedAt: string): void {
  const last = loadSyncStatus(db);
  writeSyncStatus(db, { finishedAt, error: null, succeededAt: finishedAt, syncedThrough: last?.syncedThrough ?? null });
}

const SYNC_STATUS_ID = 1;

function writeSyncStatus(db: Pick<Db, "insert">, status: SyncStatus): void {
  const row = { id: SYNC_STATUS_ID, ...status };
  db.insert(syncStatus).values(row).onConflictDoUpdate({ target: syncStatus.id, set: row }).run();
}

/** The outcome of the latest sync, or null before the first one. */
export function loadSyncStatus(db: Db): SyncStatus | null {
  return (
    db
      .select({
        finishedAt: syncStatus.finishedAt,
        error: syncStatus.error,
        succeededAt: syncStatus.succeededAt,
        syncedThrough: syncStatus.syncedThrough,
      })
      .from(syncStatus)
      .where(eq(syncStatus.id, SYNC_STATUS_ID))
      .get() ?? null
  );
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
      intervals: activities.intervals,
    })
    .from(activities)
    .orderBy(asc(activities.date), asc(activities.id))
    .all();
}
