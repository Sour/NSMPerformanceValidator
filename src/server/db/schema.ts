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
