import { addDays, localDate } from "../domain/localDate";
import { isRun, matchActivities, type Activity, type PlannedWorkout } from "../domain/matching";
import { runType } from "../domain/runType";
import type { Db } from "./db";
import {
  eventVersion,
  isNsmEvent,
  runLthr,
  runMaxHr,
  runThresholdPace,
  toActivity,
  toPlannedWorkout,
  type IntervalsClient,
  type IntervalsEvent,
} from "./intervals";
import {
  deleteActivity,
  loadActivities,
  loadCrossTraining,
  loadPlannedWorkouts,
  loadSyncStatus,
  loadWeekPlans,
  recordSyncWithNothingToStore,
  saveActivity,
  saveAthleteSettings,
  saveStreams,
  saveSync,
  saveWeekPlan,
} from "./store";

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
  crossTraining: number;
}

/**
 * Pulls Planned Workouts, running Activities and Cross-Training since the first [NSM] Planned Workout
 * from intervals.icu and stores them with their raw responses, and every workout's streams for its Training Load.
 * `today` is a YYYY-MM-DD local date.
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
          .filter(isNsmEvent)
          .map((e) => localDate(e.start_date_local))
          .sort()[0];
  if (nsmStart === undefined) {
    recordSyncWithNothingToStore(db, new Date().toISOString());
    return { nsmStart: null, plannedWorkouts: 0, activities: 0, crossTraining: 0 };
  }

  const planned = events.filter((e) => localDate(e.start_date_local) >= nsmStart);
  const recorded = await client.activities(laterDate(from, nsmStart), addDays(today, 1));
  const runningActivities = recorded.filter(isRun);
  const crossTraining = recorded.filter((a) => !isRun(a));

  const plannedWorkouts = planned.map(toPlannedWorkout);
  const activitiesInWindow = runningActivities.map(toActivity);
  const intervals = new Map<string, unknown>();
  for (const id of matchedQualityRunIds(plannedWorkouts, activitiesInWindow)) {
    intervals.set(id, await client.intervals(id));
  }
  const streams = new Map<string, unknown>();
  for (const { id } of runningActivities) streams.set(id, await client.streams(id));
  for (const { id } of crossTraining) streams.set(id, await crossTrainingStreams(client, id));

  saveSync(
    db,
    { from, to },
    planned,
    runningActivities,
    intervals,
    { finishedAt: new Date().toISOString(), syncedThrough: today },
    streams,
    crossTraining,
  );
  flagChangedWeekPlans(db, today);
  await backfillStreams(db, client);
  await syncAthleteSettings(db, client);
  return { nsmStart, plannedWorkouts: planned.length, activities: runningActivities.length, crossTraining: crossTraining.length };
}

/**
 * Flags a Week Plan Changed on intervals.icu when a workout it pushed for a day still to come was edited or deleted
 * there since. Days that have passed are left alone: their workouts are never pushed again, and pairing an Activity
 * with one is no edit.
 */
function flagChangedWeekPlans(db: Db, today: string): void {
  const stored = new Map(loadPlannedWorkouts(db).map((p) => [String(p.id), p.raw as IntervalsEvent]));
  for (const plan of loadWeekPlans(db)) {
    if (plan.changedOnIntervals) continue;
    const changed = Object.entries(plan.pushed).some(([date, { eventId, version }]) => {
      if (date < today || eventId === null) return false;
      const event = stored.get(eventId);
      return event === undefined || eventVersion(event) !== version;
    });
    if (changed) saveWeekPlan(db, { ...plan, changedOnIntervals: true });
  }
}

/**
 * Fetches the streams of stored Activities and Cross-Training that have none, such as those stored before every
 * workout's streams were.
 */
async function backfillStreams(db: Db, client: IntervalsClient): Promise<void> {
  for (const { id, streams } of loadActivities(db)) if (streams === null) saveStreams(db, id, await client.streams(id));
  for (const { id, streams } of loadCrossTraining(db)) if (streams === null) saveStreams(db, id, await crossTrainingStreams(client, id));
}

/**
 * A Cross-Training workout's streams. One logged by hand, without a recording, may have none to give, so a failed
 * request stores an empty response, a workout without heart rate, rather than failing the sync or asking every time.
 */
async function crossTrainingStreams(client: IntervalsClient, id: string): Promise<unknown> {
  return (await client.streams(id).catch(() => null)) ?? [];
}

/**
 * Stores the intervals.icu Threshold Pace, Max HR and LTHR from the athlete's Run settings. The Threshold Pace is only a
 * reference beside LT2 Pace, without Max HR only Easy Pace goes, and without LTHR only pushing Quality Runs, so a
 * failed request clears them rather than failing the sync.
 */
async function syncAthleteSettings(db: Db, client: IntervalsClient): Promise<void> {
  const athlete = await client.athlete().catch(() => null);
  saveAthleteSettings(db, { runThresholdPace: runThresholdPace(athlete), maxHr: runMaxHr(athlete), lthr: runLthr(athlete) });
}

/** What a Re-fetch found: the Activity is still Matched to a Quality Run, is no longer, or is gone from intervals.icu. */
export type RefetchOutcome = "Updated" | "NotQualityRun" | "Deleted";

/**
 * Reloads one Activity from intervals.icu, with its streams and, while it is Matched to a Quality Run, its detected
 * intervals, and stores them as a sync would, whatever the Activity's age.
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
  const isQualityRun = matchedQualityRunIds(planned, candidates).includes(activityId);
  const intervals = isQualityRun ? await client.intervals(activityId) : null;
  const streams = await client.streams(activityId);
  saveActivity(db, fetched, { intervals, streams }, new Date().toISOString());
  return isQualityRun ? "Updated" : "NotQualityRun";
}

/** The Activities Matched to a Quality Run, whose Reps are read from their detected intervals. */
function matchedQualityRunIds(planned: PlannedWorkout[], runningActivities: Activity[]): string[] {
  return matchActivities(planned, runningActivities)
    .filter((m) => runType(planned.find((p) => p.id === m.plannedWorkoutId)!.name) === "Quality Run")
    .map((m) => m.activityId);
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}
