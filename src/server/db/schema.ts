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
  syncedAt: text("synced_at").notNull(),
});
