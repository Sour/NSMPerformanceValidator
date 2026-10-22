import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import type { IntervalsActivity, IntervalsClient, IntervalsEvent } from "./intervals";
import { loadActivities, loadPlannedWorkouts } from "./store";
import { sync } from "./sync";

function event(id: number, date: string, name: string, description = "[NSM]", extra: Partial<IntervalsEvent> = {}): IntervalsEvent {
  return {
    id,
    start_date_local: `${date}T12:00:00`,
    category: "WORKOUT",
    type: "Run",
    name,
    description,
    paired_activity_id: null,
    ...extra,
  };
}

function activity(id: string, date: string, type: string, extra: Partial<IntervalsActivity> = {}): IntervalsActivity {
  return {
    id,
    start_date_local: `${date}T08:00:00`,
    type,
    name: `Everett ${type}`,
    moving_time: 2400,
    distance: 6000,
    paired_event_id: null,
    ...extra,
  };
}

function fakeClient(events: IntervalsEvent[], activities: IntervalsActivity[]): IntervalsClient {
  const within = (oldest: string, newest: string) => (x: { start_date_local: string }) =>
    x.start_date_local.slice(0, 10) >= oldest && x.start_date_local.slice(0, 10) <= newest;
  return {
    events: async (oldest, newest) => events.filter(within(oldest, newest)),
    activities: async (oldest, newest) => activities.filter(within(oldest, newest)),
  };
}

const events = [
  event(100, "2026-09-20", "Marathon", "race day"),
  event(1, "2026-09-29", "Easy Run"),
  event(2, "2026-09-30", "4 x 6:00 at 163–177 bpm", "- 15m 62-70% HR\n[NSM]", { paired_activity_id: "i2" }),
  event(3, "2026-10-04", "Note", "", { category: "NOTE", type: null }),
];

const activities = [
  activity("i0", "2026-09-28", "Run"),
  activity("i1", "2026-09-29", "Run", { name: "Everett - Easy Run" }),
  activity("i2", "2026-09-30", "Run", { paired_event_id: 2 }),
  activity("walk", "2026-09-30", "Walk"),
  activity("lift", "2026-10-01", "WeightTraining", { distance: null }),
];

describe("sync", () => {
  it("stores Planned Workouts and running Activities since the first [NSM] Planned Workout, with raw responses", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");

    expect(loadPlannedWorkouts(db)).toEqual([
      { id: 1, date: "2026-09-29", name: "Easy Run", pairedActivityId: null, raw: events[1] },
      { id: 2, date: "2026-09-30", name: "4 x 6:00 at 163–177 bpm", pairedActivityId: "i2", raw: events[2] },
    ]);
    expect(loadActivities(db).map((a) => a.id)).toEqual(["i1", "i2"]);
    expect(loadActivities(db)[1]).toMatchObject({
      date: "2026-09-30",
      type: "Run",
      name: "Everett Run",
      movingTime: 2400,
      pairedEventId: 2,
      raw: activities[2],
    });
  });

  it("is idempotent", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-02");
    const first = { planned: loadPlannedWorkouts(db), activities: loadActivities(db) };
    await sync(db, client, "2026-10-02");
    expect({ planned: loadPlannedWorkouts(db), activities: loadActivities(db) }).toEqual(first);
  });

  it("drops Planned Workouts and Activities that intervals.icu no longer returns", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events.slice(0, 2), activities.slice(0, 2)), "2026-10-02");
    expect(loadPlannedWorkouts(db).map((p) => p.id)).toEqual([1]);
    expect(loadActivities(db).map((a) => a.id)).toEqual(["i1"]);
  });

  it("stores nothing until a Planned Workout is tagged [NSM]", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient([events[0]!], activities), "2026-10-02");
    expect(loadPlannedWorkouts(db)).toEqual([]);
    expect(loadActivities(db)).toEqual([]);
  });

  it("leaves stored data alone when a sync finds no [NSM] Planned Workout", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient([], []), "2026-10-02");
    expect(loadPlannedWorkouts(db).map((p) => p.id)).toEqual([1, 2]);
    expect(loadActivities(db).map((a) => a.id)).toEqual(["i1", "i2"]);
  });
});
