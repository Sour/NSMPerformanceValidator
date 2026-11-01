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
