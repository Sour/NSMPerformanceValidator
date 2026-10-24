import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import type { IntervalsActivity, IntervalsClient, IntervalsEvent } from "./intervals";
import { loadActivities, loadPlannedWorkouts, loadRunThresholdPace, loadSyncStatus } from "./store";
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

type FakeClient = IntervalsClient & { requests: string[] };

/**
 * Serves the given data by date range, recording each request as "events oldest..newest", "intervals id" or "athlete".
 * `athlete` is the athlete response, or an Error to fail that request with.
 */
function fakeClient(
  events: IntervalsEvent[],
  activities: IntervalsActivity[],
  athlete: unknown = { sportSettings: [{ types: ["Run"], threshold_pace: 4.47 }] },
): FakeClient {
  const requests: string[] = [];
  const within = (oldest: string, newest: string) => (x: { start_date_local: string }) =>
    x.start_date_local.slice(0, 10) >= oldest && x.start_date_local.slice(0, 10) <= newest;
  return {
    requests,
    events: async (oldest, newest) => {
      requests.push(`events ${oldest}..${newest}`);
      return events.filter(within(oldest, newest));
    },
    activities: async (oldest, newest) => {
      requests.push(`activities ${oldest}..${newest}`);
      return activities.filter(within(oldest, newest));
    },
    intervals: async (activityId) => {
      requests.push(`intervals ${activityId}`);
      return intervalsResponse(activityId);
    },
    athlete: async () => {
      requests.push("athlete");
      if (athlete instanceof Error) throw athlete;
      return athlete;
    },
  };
}

function intervalsResponse(activityId: string) {
  return { id: activityId, icu_intervals: [{ type: "WORK", moving_time: 360, gap: 3.2, average_heartrate: 165 }] };
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

  it("stores the detected intervals of Matched Quality Runs only", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-02");
    expect(client.requests.filter((r) => r.startsWith("intervals"))).toEqual(["intervals i2"]);
    expect(loadActivities(db).map((a) => [a.id, a.intervals])).toEqual([
      ["i1", null],
      ["i2", intervalsResponse("i2")],
    ]);
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

  it("searches a year back until a Planned Workout is tagged [NSM]", async () => {
    const db = openDb(":memory:");
    const client = fakeClient([events[0]!], activities);
    await sync(db, client, "2026-10-02");
    await sync(db, client, "2026-10-03");
    expect(client.requests).toEqual(["events 2025-10-02..2026-10-30", "events 2025-10-03..2026-10-31"]);
  });

  it("after a successful sync, only fetches from a week before it", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-15");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-20");
    expect(client.requests.filter((r) => !r.startsWith("intervals"))).toEqual([
      "events 2026-10-08..2026-11-17",
      "activities 2026-10-08..2026-10-21",
      "athlete",
    ]);
  });

  it("never fetches from before the first [NSM] Planned Workout", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-03");
    expect(client.requests).toEqual([
      "events 2026-09-29..2026-10-31",
      "activities 2026-09-29..2026-10-04",
      "intervals i2",
      "athlete",
    ]);
  });

  it("keeps data from before the re-fetched window and stores what is new in it", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-15");
    const later = [event(4, "2026-10-21", "Easy Run")];
    const laterRuns = [activity("i4", "2026-10-21", "Run")];
    await sync(db, fakeClient(later, laterRuns), "2026-10-21");
    expect(loadPlannedWorkouts(db).map((p) => p.id)).toEqual([1, 2, 4]);
    expect(loadActivities(db).map((a) => a.id)).toEqual(["i1", "i2", "i4"]);
  });

  it("records when it last finished and through which date it synced", async () => {
    const db = openDb(":memory:");
    expect(loadSyncStatus(db)).toBeNull();
    await sync(db, fakeClient(events, activities), "2026-10-02");
    const status = loadSyncStatus(db);
    expect(status).toEqual({
      finishedAt: expect.any(String),
      error: null,
      succeededAt: status?.finishedAt,
      syncedThrough: "2026-10-02",
    });
  });

  it("stores the intervals.icu Threshold Pace from the athlete's Run settings", async () => {
    const db = openDb(":memory:");
    expect(loadRunThresholdPace(db)).toBeNull();
    await sync(db, fakeClient(events, activities), "2026-10-02");
    expect(loadRunThresholdPace(db)).toBe(4.47);
  });

  it("keeps the last intervals.icu Threshold Pace, and still succeeds, when the athlete request fails", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events, activities, new Error("intervals.icu athlete failed: 500")), "2026-10-03");
    expect(loadRunThresholdPace(db)).toBe(4.47);
    expect(loadSyncStatus(db)).toMatchObject({ error: null, syncedThrough: "2026-10-03" });
  });

  it("clears the intervals.icu Threshold Pace once Run has none", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events, activities, { sportSettings: [] }), "2026-10-03");
    expect(loadRunThresholdPace(db)).toBeNull();
  });

  it("records a sync that found no [NSM] Planned Workout without a synced-through date", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient([events[0]!], activities), "2026-10-02");
    expect(loadSyncStatus(db)).toMatchObject({ error: null, succeededAt: expect.any(String), syncedThrough: null });
  });
});
