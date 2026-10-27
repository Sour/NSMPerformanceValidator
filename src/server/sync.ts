import { addDays, localDate } from "../domain/localDate";
import { isRun, matchActivities, type Activity, type PlannedWorkout } from "../domain/matching";
import { runType, type RunType } from "../domain/runType";
import type { Db } from "./db";
import { runMaxHr, runThresholdPace, toActivity, toPlannedWorkout, type IntervalsClient } from "./intervals";
import {
  deleteActivity,
  loadActivities,
  loadPlannedWorkouts,
  loadSyncStatus,
  recordSyncWithNothingToStore,
  saveActivity,
  saveAthleteSettings,
  saveStreams,
  saveSync,
} from "./store";

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

  const plannedWorkouts = planned.map(toPlannedWorkout);
  const activitiesInWindow = runningActivities.map(toActivity);
  const intervals = new Map<string, unknown>();
  for (const id of matchedActivityIds(plannedWorkouts, activitiesInWindow, QUALITY_RUN_TYPES)) {
    intervals.set(id, await client.intervals(id));
  }
  const streams = new Map<string, unknown>();
  for (const id of matchedActivityIds(plannedWorkouts, activitiesInWindow, EASY_RUN_TYPES)) {
    streams.set(id, await client.streams(id));
  }

  saveSync(
    db,
    { from, to },
    planned,
    runningActivities,
    intervals,
    { finishedAt: new Date().toISOString(), syncedThrough: today },
    streams,
  );
  await backfillStreams(db, client);
  await syncAthleteSettings(db, client);
  return { nsmStart, plannedWorkouts: planned.length, activities: runningActivities.length };
}

/** Fetches the streams of stored Easy Runs and Long Runs that have none, such as those stored before streams were. */
async function backfillStreams(db: Db, client: IntervalsClient): Promise<void> {
  const stored = loadActivities(db);
  const missing = matchedActivityIds(loadPlannedWorkouts(db), stored, EASY_RUN_TYPES).filter(
    (id) => stored.find((a) => a.id === id)!.streams === null,
  );
  for (const id of missing) saveStreams(db, id, await client.streams(id));
}

/**
 * Stores the intervals.icu Threshold Pace and Max HR from the athlete's Run settings. The Threshold Pace is only a
 * reference beside LT2 Pace, and without Max HR only Easy Pace goes, so a failed request clears them rather than
 * failing the sync.
 */
async function syncAthleteSettings(db: Db, client: IntervalsClient): Promise<void> {
  const athlete = await client.athlete().catch(() => null);
  saveAthleteSettings(db, { runThresholdPace: runThresholdPace(athlete), maxHr: runMaxHr(athlete) });
}

/** What a Re-fetch found: the Activity is still Matched to a Quality Run, is no longer, or is gone from intervals.icu. */
export type RefetchOutcome = "Updated" | "NotQualityRun" | "Deleted";

/**
 * Reloads one Activity from intervals.icu, with its detected intervals while it is Matched to a Quality Run or its
 * streams while it is Matched to an Easy Run or Long Run, and stores them as a sync would, whatever the Activity's age.
 * Nothing else is fetched or changed. An Activity intervals.icu no longer has, or that is no longer a running Activity,
 * is removed. When a request fails, it rejects and stored data is unchanged.
 */
export async function refetchActivity(db: Db, client: IntervalsClient, activityId: string): Promise<RefetchOutcome> {
  const fetched = await client.activity(activityId);
  if (fetched === null || !isRun(fetched)) {
    deleteActivity(db, activityId);
    return fetched === null ? "Deleted" : "NotQualityRun";
  }
  const planned = loadPlannedWorkouts(db);
  const candidates = [...loadActivities(db).filter((a) => a.id !== activityId), toActivity(fetched)];
  const isQualityRun = matchedActivityIds(planned, candidates, QUALITY_RUN_TYPES).includes(activityId);
  const isEasy = matchedActivityIds(planned, candidates, EASY_RUN_TYPES).includes(activityId);
  const intervals = isQualityRun ? await client.intervals(activityId) : null;
  const streams = isEasy ? await client.streams(activityId) : null;
  saveActivity(db, fetched, { intervals, streams }, new Date().toISOString());
  return isQualityRun ? "Updated" : "NotQualityRun";
}

/** Quality Runs' Reps are read from their detected intervals. */
const QUALITY_RUN_TYPES: RunType[] = ["Quality Run"];
/** Easy Runs' and Long Runs' Walk Breaks and time above the Easy HR Target are read from their streams. */
const EASY_RUN_TYPES: RunType[] = ["Easy Run", "Long Run"];

/** The Activities Matched to a Planned Workout of one of `runTypes`. */
function matchedActivityIds(planned: PlannedWorkout[], runningActivities: Activity[], runTypes: RunType[]): string[] {
  return matchActivities(planned, runningActivities)
    .filter((m) => {
      const type = runType(planned.find((p) => p.id === m.plannedWorkoutId)!.name);
      return type !== null && runTypes.includes(type);
    })
    .map((m) => m.activityId);
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}
