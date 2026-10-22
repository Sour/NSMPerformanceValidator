import { Hono } from "hono";
import { trainingWeek, type TrainingWeek } from "../domain/trainingWeek";
import type { Db } from "./db";
import { loadActivities, loadPlannedWorkouts, type StoredActivity } from "./store";

export type WeekActivity = Omit<StoredActivity, "raw">;
export type WeekResponse = TrainingWeek<WeekActivity> & { today: string };

export function createApp(db: Db, today: () => string) {
  return new Hono().get("/api/week", (c) => {
    const date = today();
    const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
    const activities = loadActivities(db).map(({ raw: _, ...a }) => a);
    return c.json<WeekResponse>({ today: date, ...trainingWeek(date, planned, activities) });
  });
}
