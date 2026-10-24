import { addDays, localDate } from "../domain/localDate";
import { isRun, matchActivities } from "../domain/matching";
import { runType } from "../domain/runType";
import type { Db } from "./db";
import {
  runThresholdPace,
  toActivity,
  toPlannedWorkout,
  type IntervalsActivity,
  type IntervalsClient,
  type IntervalsEvent,
} from "./intervals";
import { loadPlannedWorkouts, loadSyncStatus, recordSyncWithNothingToStore, saveRunThresholdPace, saveSync } from "./store";

/** Marks a Planned Workout as part of the NSM plan, in its intervals.icu description. */
const NSM_TAG = "[NSM]";
/** How far back the first sync looks for the first [NSM] Planned Workout. */
const FIRST_SYNC_LOOKBACK_DAYS = 365;
/** How far ahead Planned Workouts are synced. */
const LOOKAHEAD_DAYS = 28;
/** How far before the last successful sync later syncs re-fetch, to pick up late uploads and edits. */
const REFETCH_DAYS = 7;

export interface SyncResult {
  /** Date of the first [NSM] Planned Workout, or null when there is none yet. */
  nsmStart: string | null;
  plannedWorkouts: number;
  activities: number;
}

/**
 * Pulls Planned Workouts and running Activities since the first [NSM] Planned Workout
 * from intervals.icu and stores them with their raw responses. `today` is a YYYY-MM-DD local date.
 * Once a sync has stored data, later ones only re-fetch from shortly before it.
 * Until a Planned Workout is tagged [NSM], stored data is left as it is.
 */
export async function sync(db: Db, client: IntervalsClient, today: string): Promise<SyncResult> {
  const storedStart = loadPlannedWorkouts(db)[0]?.date;
  const syncedThrough = loadSyncStatus(db)?.syncedThrough;
  const incremental = storedStart !== undefined && syncedThrough != null;
  const from = incremental
    ? laterDate(storedStart, addDays(syncedThrough, -REFETCH_DAYS))
    : (storedStart ?? addDays(today, -FIRST_SYNC_LOOKBACK_DAYS));
  const to = addDays(today, LOOKAHEAD_DAYS);

  const events = (await client.events(from, to)).filter((e) => e.category === "WORKOUT" && e.type === "Run");
  const nsmStart = incremental
    ? storedStart
      : events
          .filter((e) => e.description?.includes(NSM_TAG))
          .map((e) => localDate(e.start_date_local))
          .sort()[0];
  if (nsmStart === undefined) {
    recordSyncWithNothingToStore(db, new Date().toISOString());
    return { nsmStart: null, plannedWorkouts: 0, activities: 0 };
  }

  const planned = events.filter((e) => localDate(e.start_date_local) >= nsmStart);
  const runningActivities = (await client.activities(laterDate(from, nsmStart), addDays(today, 1))).filter(isRun);

  const intervals = new Map<string, unknown>();
  for (const id of qualityRunActivityIds(planned, runningActivities)) intervals.set(id, await client.intervals(id));

  saveSync(db, { from, to }, planned, runningActivities, intervals, {
    finishedAt: new Date().toISOString(),
    syncedThrough: today,
  });
  await syncRunThresholdPace(db, client);
  return { nsmStart, plannedWorkouts: planned.length, activities: runningActivities.length };
}

/**
 * Stores the intervals.icu Threshold Pace from the athlete's Run settings. It is only a reference beside LT2 Pace,
 * so a failed request keeps the last one stored rather than failing the sync.
 */
async function syncRunThresholdPace(db: Db, client: IntervalsClient): Promise<void> {
  let athlete: unknown;
  try {
    athlete = await client.athlete();
  } catch {
    return;
  }
  saveRunThresholdPace(db, runThresholdPace(athlete));
}

/** The Activities Matched to a Quality Run, whose Reps are read from their detected intervals. */
function qualityRunActivityIds(events: IntervalsEvent[], runningActivities: IntervalsActivity[]): string[] {
  const planned = events.map(toPlannedWorkout);
  return matchActivities(planned, runningActivities.map(toActivity))
    .filter((m) => runType(planned.find((p) => p.id === m.plannedWorkoutId)!.name) === "Quality Run")
    .map((m) => m.activityId);
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}
