import { and, asc, between, eq, notInArray } from "drizzle-orm";
import type { EasyHrTarget } from "../domain/easyTrend";
import type { FitnessStart } from "../domain/fitness";
import type { Activity, PlannedWorkout } from "../domain/matching";
import type { PushedDay, WeekPlanDay } from "../domain/weekPlan";
import type { Db } from "./db";
import type { GarminFailure } from "./garmin";
import {
  activities,
  athleteSettings,
  crossTraining,
  fitnessStart,
  garminSync,
  plannedWorkouts,
  plannerSettings,
  planSuggestionDismissals,
  syncBackfills,
  syncStatus,
  weekPlans,
} from "./db/schema";
import { toActivity, toPlannedWorkout, type IntervalsActivity, type IntervalsEvent } from "./intervals";

export type StoredPlannedWorkout = PlannedWorkout & { raw: unknown };
/**
 * `intervals` is intervals.icu's detected intervals response and `streams` its streams response, each null when it
 * was not fetched.
 */
export type StoredActivity = Activity & { distance: number | null; raw: unknown; intervals: unknown; streams: unknown };
/** A Cross-Training workout; `streams` is intervals.icu's streams response, null when it was not fetched. */
export type StoredCrossTraining = Pick<Activity, "id" | "date" | "type" | "name" | "movingTime"> & { raw: unknown; streams: unknown };

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
 * Makes the stored Planned Workouts and Activities dated within `window`, and the Cross-Training dated from
 * `crossTrainingFrom` through its end, exactly those given, keyed by intervals.icu id, and records the sync as
 * successful. `intervals` and `streams` hold the detected intervals and streams responses fetched for some of the
 * Activities and Cross-Training, by intervals.icu id.
 */
export function saveSync(
  db: Db,
  window: SyncWindow,
  events: IntervalsEvent[],
  runningActivities: IntervalsActivity[],
  intervals: ReadonlyMap<string, unknown>,
  { finishedAt, syncedThrough }: SyncedData,
  streams: ReadonlyMap<string, unknown> = new Map(),
  crossTrainingWorkouts: IntervalsActivity[] = [],
  crossTrainingFrom: string = window.from,
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
      upsertActivity(tx, a, { intervals: intervals.get(a.id) ?? null, streams: streams.get(a.id) ?? null }, finishedAt);
    }
    tx.delete(activities)
      .where(
        and(
          between(activities.date, window.from, window.to),
          notInArray(activities.id, runningActivities.map((a) => a.id)),
        ),
      )
      .run();

    for (const a of crossTrainingWorkouts) {
      const row = { ...toCrossTraining(a), raw: a, streams: streams.get(a.id) ?? null, syncedAt: finishedAt };
      tx.insert(crossTraining).values(row).onConflictDoUpdate({ target: crossTraining.id, set: row }).run();
    }
    tx.delete(crossTraining)
      .where(
        and(
          between(crossTraining.date, crossTrainingFrom, window.to),
          notInArray(crossTraining.id, crossTrainingWorkouts.map((a) => a.id)),
        ),
      )
      .run();

    writeSyncStatus(tx, { finishedAt, error: null, succeededAt: finishedAt, syncedThrough });
  });
}

/** Stores one running Activity with what was fetched beside it, as a sync would. */
export function saveActivity(db: Db, activity: IntervalsActivity, fetched: Fetched, syncedAt: string): void {
  upsertActivity(db, activity, fetched, syncedAt);
}

/** Stores the streams response of one stored Activity or Cross-Training workout, leaving the rest of it as it is. */
export function saveStreams(db: Db, id: string, streams: unknown): void {
  db.update(activities).set({ streams }).where(eq(activities.id, id)).run();
  db.update(crossTraining).set({ streams }).where(eq(crossTraining.id, id)).run();
}

/** Removes one stored Activity; nothing happens when it is not stored. */
export function deleteActivity(db: Db, activityId: string): void {
  db.delete(activities).where(eq(activities.id, activityId)).run();
}

/** The detected intervals and streams responses fetched for an Activity; each null when not fetched. */
export interface Fetched {
  intervals: unknown;
  streams: unknown;
}

function upsertActivity(db: Pick<Db, "insert">, a: IntervalsActivity, { intervals, streams }: Fetched, syncedAt: string): void {
  const row = { ...toActivity(a), distance: a.distance ?? null, raw: a, intervals, streams, syncedAt };
  db.insert(activities).values(row).onConflictDoUpdate({ target: activities.id, set: row }).run();
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

const SYNC_BACKFILLS_ID = 1;

/** The one-off catch-ups sync has done for data stored before it fetched it. */
export type SyncBackfills = Omit<typeof syncBackfills.$inferSelect, "id">;

export function loadSyncBackfills(db: Db): SyncBackfills {
  const row = db.select().from(syncBackfills).where(eq(syncBackfills.id, SYNC_BACKFILLS_ID)).get();
  return {
    crossTrainingFrom: row?.crossTrainingFrom ?? null,
    speedStreams: row?.speedStreams ?? false,
    gradeAdjustedSpeedStreams: row?.gradeAdjustedSpeedStreams ?? false,
  };
}

/** Records the given catch-ups as done, leaving the others as they are. */
export function saveSyncBackfills(db: Db, done: Partial<SyncBackfills>): void {
  const row = { id: SYNC_BACKFILLS_ID, ...loadSyncBackfills(db), ...done };
  db.insert(syncBackfills).values(row).onConflictDoUpdate({ target: syncBackfills.id, set: row }).run();
}

const FITNESS_START_ID = 1;

export function loadFitnessStart(db: Db): FitnessStart | null {
  return (
    db
      .select({ date: fitnessStart.date, fitness: fitnessStart.fitness, fatigue: fitnessStart.fatigue })
      .from(fitnessStart)
      .where(eq(fitnessStart.id, FITNESS_START_ID))
      .get() ?? null
  );
}

export function saveFitnessStart(db: Db, start: FitnessStart): void {
  const row = { id: FITNESS_START_ID, ...start };
  db.insert(fitnessStart).values(row).onConflictDoUpdate({ target: fitnessStart.id, set: row }).run();
}

/** The first day of stored history: the earliest stored Planned Workout, Activity or Cross-Training; null when none. */
export function historyStart(db: Db): string | null {
  const firsts = [
    db.select({ date: plannedWorkouts.date }).from(plannedWorkouts).orderBy(asc(plannedWorkouts.date)).limit(1).get(),
    db.select({ date: activities.date }).from(activities).orderBy(asc(activities.date)).limit(1).get(),
    db.select({ date: crossTraining.date }).from(crossTraining).orderBy(asc(crossTraining.date)).limit(1).get(),
  ];
  return firsts.flatMap((row) => (row ? [row.date] : [])).sort()[0] ?? null;
}

const GARMIN_SYNC_ID = 1;

/** One threshold's value before and after a change, in bpm. */
export interface ThresholdChange {
  from: number | null;
  to: number;
}

/** How syncing the running LTHR and Max HR from Garmin is going. */
export interface GarminSyncStatus {
  /** Why Garmin could not be read, and since when (an ISO timestamp); null while it can. */
  failure: { kind: GarminFailure; since: string } | null;
  /** The latest change written to intervals.icu from Garmin; each threshold null when it did not change. */
  lastChange: { at: string; lthr: ThresholdChange | null; maxHr: ThresholdChange | null } | null;
}

/** How syncing from Garmin is going; no failure and no change before a sync with a Garmin key has run. */
export function loadGarminSyncStatus(db: Db): GarminSyncStatus {
  const row = db.select().from(garminSync).where(eq(garminSync.id, GARMIN_SYNC_ID)).get();
  const change = (from: number | null | undefined, to: number | null | undefined): ThresholdChange | null =>
    to == null ? null : { from: from ?? null, to };
  return {
    failure: row?.failure && row.failingSince ? { kind: row.failure as GarminFailure, since: row.failingSince } : null,
    lastChange: row?.changedAt
      ? { at: row.changedAt, lthr: change(row.lthrFrom, row.lthrTo), maxHr: change(row.maxHrFrom, row.maxHrTo) }
      : null,
  };
}

/** Records how syncing from Garmin is going, replacing what was recorded. */
export function saveGarminSyncStatus(db: Db, { failure, lastChange }: GarminSyncStatus): void {
  const row = {
    id: GARMIN_SYNC_ID,
    failure: failure?.kind ?? null,
    failingSince: failure?.since ?? null,
    changedAt: lastChange?.at ?? null,
    lthrFrom: lastChange?.lthr?.from ?? null,
    lthrTo: lastChange?.lthr?.to ?? null,
    maxHrFrom: lastChange?.maxHr?.from ?? null,
    maxHrTo: lastChange?.maxHr?.to ?? null,
  };
  db.insert(garminSync).values(row).onConflictDoUpdate({ target: garminSync.id, set: row }).run();
}

const ATHLETE_SETTINGS_ID = 1;

/** What the latest sync read from the athlete's intervals.icu Run settings; each null when none is set. */
export interface AthleteSettings {
  /** The intervals.icu Threshold Pace, in metres per second. */
  runThresholdPace: number | null;
  /** Max HR, in bpm. */
  maxHr: number | null;
  /** LTHR, in bpm. */
  lthr: number | null;
}

/** Records what the latest sync read from the athlete's intervals.icu Run settings. */
export function saveAthleteSettings(db: Db, settings: AthleteSettings): void {
  const row = { id: ATHLETE_SETTINGS_ID, ...settings };
  db.insert(athleteSettings).values(row).onConflictDoUpdate({ target: athleteSettings.id, set: row }).run();
}

/** What the latest sync read from the athlete's intervals.icu Run settings; all null before the first sync. */
export function loadAthleteSettings(db: Db): AthleteSettings {
  return (
    db
      .select({ runThresholdPace: athleteSettings.runThresholdPace, maxHr: athleteSettings.maxHr, lthr: athleteSettings.lthr })
      .from(athleteSettings)
      .where(eq(athleteSettings.id, ATHLETE_SETTINGS_ID))
      .get() ?? { runThresholdPace: null, maxHr: null, lthr: null }
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
      streams: activities.streams,
    })
    .from(activities)
    .orderBy(asc(activities.date), asc(activities.id))
    .all();
}

export function loadCrossTraining(db: Db): StoredCrossTraining[] {
  return db
    .select({
      id: crossTraining.id,
      date: crossTraining.date,
      type: crossTraining.type,
      name: crossTraining.name,
      movingTime: crossTraining.movingTime,
      raw: crossTraining.raw,
      streams: crossTraining.streams,
    })
    .from(crossTraining)
    .orderBy(asc(crossTraining.date), asc(crossTraining.id))
    .all();
}

function toCrossTraining(a: IntervalsActivity): Omit<StoredCrossTraining, "raw" | "streams"> {
  const { id, date, type, name, movingTime } = toActivity(a);
  return { id, date, type, name, movingTime };
}

/** A stored Week Plan: the draft and what pushes made of it. */
export interface StoredWeekPlan {
  /** The Training Week's Monday. */
  week: string;
  /** The draft, Monday first. */
  days: WeekPlanDay[];
  /** What the pushes made of each day, by date; empty until the first push. */
  pushed: Record<string, PushedDay>;
  /** When the latest push finished, as an ISO timestamp; null before the first. */
  pushedAt: string | null;
  /** A sync found a pushed workout edited or deleted on intervals.icu since the latest push. */
  changedOnIntervals: boolean;
}

export function loadWeekPlan(db: Db, week: string): StoredWeekPlan | null {
  const row = db.select().from(weekPlans).where(eq(weekPlans.week, week)).get();
  return row ? toStoredWeekPlan(row) : null;
}

/** Every stored Week Plan, oldest first. */
export function loadWeekPlans(db: Db): StoredWeekPlan[] {
  return db.select().from(weekPlans).orderBy(asc(weekPlans.week)).all().map(toStoredWeekPlan);
}

function toStoredWeekPlan(row: typeof weekPlans.$inferSelect): StoredWeekPlan {
  return { ...row, days: row.days as WeekPlanDay[], pushed: row.pushed as Record<string, PushedDay> };
}

export function saveWeekPlan(db: Db, plan: StoredWeekPlan): void {
  db.insert(weekPlans).values(plan).onConflictDoUpdate({ target: weekPlans.week, set: plan }).run();
}

const PLANNER_SETTINGS_ID = 1;

/** What the runner has set for the planner; each null when not set, so its default applies. */
export interface StoredPlannerSettings {
  easyHrTarget: EasyHrTarget | null;
  qualityShareTarget: number | null;
}

export function loadPlannerSettings(db: Db): StoredPlannerSettings {
  const row = db.select().from(plannerSettings).where(eq(plannerSettings.id, PLANNER_SETTINGS_ID)).get();
  return {
    easyHrTarget: row?.easyHrLow != null && row.easyHrHigh != null ? { low: row.easyHrLow, high: row.easyHrHigh } : null,
    qualityShareTarget: row?.qualityShareTarget ?? null,
  };
}

export function savePlannerSettings(db: Db, settings: StoredPlannerSettings): void {
  const row = {
    id: PLANNER_SETTINGS_ID,
    easyHrLow: settings.easyHrTarget?.low ?? null,
    easyHrHigh: settings.easyHrTarget?.high ?? null,
    qualityShareTarget: settings.qualityShareTarget,
  };
  db.insert(plannerSettings).values(row).onConflictDoUpdate({ target: plannerSettings.id, set: row }).run();
}

/** The ids of the Plan Suggestions dismissed for the Training Week starting `week`. */
export function loadDismissals(db: Db, week: string): string[] {
  return db
    .select({ suggestionId: planSuggestionDismissals.suggestionId })
    .from(planSuggestionDismissals)
    .where(eq(planSuggestionDismissals.week, week))
    .all()
    .map((r) => r.suggestionId);
}

export function saveDismissal(db: Db, week: string, suggestionId: string): void {
  db.insert(planSuggestionDismissals).values({ week, suggestionId }).onConflictDoNothing().run();
}
