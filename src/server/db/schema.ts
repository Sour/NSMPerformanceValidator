import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  /** intervals.icu's time, heart-rate, cadence, speed and grade-adjusted speed streams response; null until fetched. */
  streams: text("streams", { mode: "json" }),
  syncedAt: text("synced_at").notNull(),
});

/** Cross-Training workouts as synced from intervals.icu: every recorded workout that is not a running Activity. */
export const crossTraining = sqliteTable("cross_training", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  movingTime: integer("moving_time").notNull(),
  raw: text("raw", { mode: "json" }).notNull(),
  /** intervals.icu's time, heart-rate, cadence, speed and grade-adjusted speed streams response; null until fetched. */
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

/** One-off catch-ups sync has done for data stored before it fetched it; a single row with id 1. */
export const syncBackfills = sqliteTable("sync_backfills", {
  id: integer("id").primaryKey(),
  /** The date from which every Cross-Training workout has been synced; null until it has been. */
  crossTrainingFrom: text("cross_training_from"),
  /** Every stored workout's streams have been fetched with a speed stream where intervals.icu has one. */
  speedStreams: integer("speed_streams", { mode: "boolean" }).notNull().default(false),
  /** Every stored workout's streams have been fetched with a grade-adjusted speed stream where intervals.icu has one. */
  gradeAdjustedSpeedStreams: integer("grade_adjusted_speed_streams", { mode: "boolean" }).notNull().default(false),
});

/**
 * Fitness and Fatigue as intervals.icu had them at the end of the day before stored history starts, which ours start
 * from; fetched once and kept. A single row with id 1.
 */
export const fitnessStart = sqliteTable("fitness_start", {
  id: integer("id").primaryKey(),
  /** YYYY-MM-DD. */
  date: text("date").notNull(),
  fitness: real("fitness").notNull(),
  fatigue: real("fatigue").notNull(),
});

/** What the latest sync read from the athlete's intervals.icu settings; a single row with id 1. */
export const athleteSettings = sqliteTable("athlete_settings", {
  id: integer("id").primaryKey(),
  /** The intervals.icu Threshold Pace of the athlete's Run settings, in metres per second; null when none is set. */
  runThresholdPace: real("run_threshold_pace"),
  /** The Max HR of the athlete's Run settings, in bpm; null when none is set. */
  maxHr: real("max_hr"),
  /** The LTHR of the athlete's Run settings, in bpm; null when none is set. */
  lthr: real("lthr"),
});

/**
 * The runner's Week Plans, one per Training Week, authored here; sync never writes them except to flag one Changed on
 * intervals.icu.
 */
export const weekPlans = sqliteTable("week_plans", {
  /** The Training Week's Monday, YYYY-MM-DD. */
  week: text("week").primaryKey(),
  /** The draft: seven Week Plan days, Monday first. */
  days: text("days", { mode: "json" }).notNull(),
  /** What the pushes made of each day, by date; empty until the first push. */
  pushed: text("pushed", { mode: "json" }).notNull(),
  /** When the latest push finished, as an ISO timestamp. */
  pushedAt: text("pushed_at"),
  /** A sync found a pushed workout edited or deleted on intervals.icu since the latest push. */
  changedOnIntervals: integer("changed_on_intervals", { mode: "boolean" }).notNull(),
});

/** What the runner has set for the planner; a single row with id 1. Each null keeps its default. */
export const plannerSettings = sqliteTable("planner_settings", {
  id: integer("id").primaryKey(),
  /** The Easy HR Target new Planned Workouts are given, as percentages of Max HR. */
  easyHrLow: real("easy_hr_low"),
  easyHrHigh: real("easy_hr_high"),
  /** The Quality Share Target, a whole percentage. */
  qualityShareTarget: integer("quality_share_target"),
});

/** Plan Suggestions the runner dismissed, each for one Training Week only. */
export const planSuggestionDismissals = sqliteTable(
  "plan_suggestion_dismissals",
  {
    /** The Training Week's Monday, YYYY-MM-DD. */
    week: text("week").notNull(),
    suggestionId: text("suggestion_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.week, t.suggestionId] })],
);

/**
 * How syncing the running LTHR and Max HR from Garmin is going (ADR 0007); a single row with id 1, absent until a sync
 * with a Garmin key has run.
 */
export const garminSync = sqliteTable("garmin_sync", {
  id: integer("id").primaryKey(),
  /** Why Garmin could not be read, since `failingSince`; null while it can. */
  failure: text("failure"),
  /** When Garmin first failed in the current run of failures, as an ISO timestamp. */
  failingSince: text("failing_since"),
  /** When the latest change from Garmin was written to intervals.icu, as an ISO timestamp; null before the first. */
  changedAt: text("changed_at"),
  /** The Run LTHR and Max HR before and after the latest change, in bpm; each pair null when that one did not change. */
  lthrFrom: real("lthr_from"),
  lthrTo: real("lthr_to"),
  maxHrFrom: real("max_hr_from"),
  maxHrTo: real("max_hr_to"),
});
