import { addDays, localDate } from "../domain/localDate";
import { isRun } from "../domain/matching";
import type { Db } from "./db";
import type { IntervalsClient } from "./intervals";
import { loadPlannedWorkouts, replaceSyncedData } from "./store";

/** Marks a Planned Workout as part of the NSM plan, in its intervals.icu description. */
const NSM_TAG = "[NSM]";
/** How far back the first sync looks for the first [NSM] Planned Workout. */
const FIRST_SYNC_LOOKBACK_DAYS = 365;
/** How far ahead Planned Workouts are synced. */
const LOOKAHEAD_DAYS = 28;

export interface SyncResult {
  /** Date of the first [NSM] Planned Workout, or null when there is none yet. */
  nsmStart: string | null;
  plannedWorkouts: number;
  activities: number;
}

/**
 * Pulls Planned Workouts and running Activities since the first [NSM] Planned Workout
 * from intervals.icu and stores them with their raw responses. `today` is a YYYY-MM-DD local date.
 * Until a Planned Workout is tagged [NSM], stored data is left as it is.
 */
export async function sync(db: Db, client: IntervalsClient, today: string): Promise<SyncResult> {
  const searchFrom = loadPlannedWorkouts(db)[0]?.date ?? addDays(today, -FIRST_SYNC_LOOKBACK_DAYS);
  const events = (await client.events(searchFrom, addDays(today, LOOKAHEAD_DAYS))).filter(
    (e) => e.category === "WORKOUT" && e.type === "Run",
  );
  const nsmStart =
    events
      .filter((e) => e.description?.includes(NSM_TAG))
      .map((e) => localDate(e.start_date_local))
      .sort()[0];
  if (nsmStart === undefined) return { nsmStart: null, plannedWorkouts: 0, activities: 0 };

  const planned = events.filter((e) => localDate(e.start_date_local) >= nsmStart);
  const runningActivities = (await client.activities(nsmStart, addDays(today, 1))).filter(isRun);

  replaceSyncedData(db, planned, runningActivities, new Date().toISOString());
  return { nsmStart, plannedWorkouts: planned.length, activities: runningActivities.length };
}
