import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Planned Workouts as synced from intervals.icu calendar events. */
export const plannedWorkouts = sqliteTable("planned_workouts", {
  id: integer("id").primaryKey(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  pairedActivityId: text("paired_activity_id"),
  raw: text("raw", { mode: "json" }).notNull(),
  syncedAt: text("synced_at").notNull(),
});

/** Running Activities as synced from intervals.icu. */
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  movingTime: integer("moving_time").notNull(),
  distance: real("distance"),
  pairedEventId: integer("paired_event_id"),
  raw: text("raw", { mode: "json" }).notNull(),
  /** intervals.icu's detected intervals response; fetched for Matched Quality Runs only. */
  intervals: text("intervals", { mode: "json" }),
  /** intervals.icu's time, heart-rate and cadence streams response; fetched for Matched Easy Runs and Long Runs only. */
  streams: text("streams", { mode: "json" }),
  syncedAt: text("synced_at").notNull(),
});

/** The outcome of the latest sync; a single row with id 1. */
export const syncStatus = sqliteTable("sync_status", {
  id: integer("id").primaryKey(),
  finishedAt: text("finished_at").notNull(),
  /** Why the latest sync failed; null when it succeeded. */
  error: text("error"),
  /** When the latest successful sync finished. */
  succeededAt: text("succeeded_at"),
  /** The local date of the last successful sync that stored data; later syncs re-fetch only from shortly before it. */
  syncedThrough: text("synced_through"),
});

/** What the latest sync read from the athlete's intervals.icu settings; a single row with id 1. */
export const athleteSettings = sqliteTable("athlete_settings", {
  id: integer("id").primaryKey(),
  /** The intervals.icu Threshold Pace of the athlete's Run settings, in metres per second; null when none is set. */
  runThresholdPace: real("run_threshold_pace"),
  /** The Max HR of the athlete's Run settings, in bpm; null when none is set. */
  maxHr: real("max_hr"),
});
