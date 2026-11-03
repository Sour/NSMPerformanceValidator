import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { GarminError, type GarminClient, type RunningThresholds } from "./garmin";
import { eventVersion, type IntervalsActivity, type IntervalsClient, type IntervalsEvent } from "./intervals";
import {
  loadActivities,
  loadAthleteSettings,
  loadCrossTraining,
  loadFitnessStart,
  loadGarminSyncStatus,
  loadPlannedWorkouts,
  loadSyncStatus,
  loadWeekPlan,
  saveFitnessStart,
  saveStreams,
  saveSync,
  saveSyncBackfills,
  saveWeekPlan,
  type StoredWeekPlan,
} from "./store";
import { refetchActivity, sync } from "./sync";

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
 * Serves the given data by date range or id, recording each request as "events oldest..newest", "activity id",
 * "intervals id", "streams id", "athlete" or "wellness date". `athlete` is the athlete response, or an Error to fail
 * that request with; `intervals` gives each Activity's intervals response and `wellness` each day's wellness response,
 * or throws to fail that request.
 */
function fakeClient(
  events: IntervalsEvent[],
  activities: IntervalsActivity[],
  athlete: unknown = { sportSettings: [{ types: ["Run"], threshold_pace: 4.47, max_hr: 201, lthr: 181 }] },
  intervals: (activityId: string) => unknown = intervalsResponse,
  wellness: (date: string) => unknown = wellnessResponse,
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
    activity: async (activityId) => {
      requests.push(`activity ${activityId}`);
      return activities.find((a) => a.id === activityId) ?? null;
    },
    intervals: async (activityId) => {
      requests.push(`intervals ${activityId}`);
      return intervals(activityId);
    },
    streams: async (activityId) => {
      requests.push(`streams ${activityId}`);
      return streamsResponse(activityId);
    },
    athlete: async () => {
      requests.push("athlete");
      if (athlete instanceof Error) throw athlete;
      return athlete;
    },
    wellness: async (date) => {
      requests.push(`wellness ${date}`);
      return wellness(date);
    },
    createEvent: async () => {
      throw new Error("Sync never writes to intervals.icu");
    },
    updateEvent: async () => {
      throw new Error("Sync never writes to intervals.icu");
    },
    deleteEvent: async () => {
      throw new Error("Sync never writes to intervals.icu");
    },
    updateRunSportSettings: async (fields) => {
      requests.push(`sport-settings Run ${JSON.stringify(fields)}`);
      const run = (athlete as { sportSettings?: { types: string[] }[] }).sportSettings?.find((s) => s.types.includes("Run"));
      Object.assign(run ?? {}, fields);
    },
  };
}

function intervalsResponse(activityId: string) {
  return { id: activityId, icu_intervals: [{ type: "WORK", moving_time: 360, gap: 3.2, average_heartrate: 165 }] };
}

function streamsResponse(activityId: string) {
  return [
    { type: "time", data: [0, 1, 2], name: activityId },
    { type: "heartrate", data: [130, 131, 132] },
    { type: "cadence", data: [80, 81, 80] },
    { type: "velocity_smooth", data: [2.5, 2.6, 2.5] },
  ];
}

/** As stored before streams were fetched with speed. */
function streamsWithoutSpeed(activityId: string) {
  return streamsResponse(activityId).filter((s) => s.type !== "velocity_smooth");
}

function wellnessResponse(date: string) {
  return { id: date, ctl: 28.1, atl: 22.4, restingHR: 50 };
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

  it("stores the heart-rate and cadence streams of every running Activity and Cross-Training workout", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-02");
    expect(client.requests.filter((r) => r.startsWith("streams"))).toEqual(["streams i1", "streams i2", "streams walk", "streams lift"]);
    expect(loadActivities(db).map((a) => [a.id, a.streams])).toEqual([
      ["i1", streamsResponse("i1")],
      ["i2", streamsResponse("i2")],
    ]);
    expect(loadCrossTraining(db).map((a) => [a.id, a.streams])).toEqual([
      ["walk", streamsResponse("walk")],
      ["lift", streamsResponse("lift")],
    ]);
  });

  it("fetches the streams of running Activities and Cross-Training stored without them, however old", async () => {
    const db = openDb(":memory:");
    saveSync(
      db,
      { from: "2026-09-01", to: "2026-10-30" },
      events.slice(1, 3),
      activities.slice(0, 3),
      new Map(),
      { finishedAt: "2026-10-20T12:00:00.000Z", syncedThrough: "2026-10-20" },
      new Map(),
      activities.slice(3),
    );
    saveSyncBackfills(db, { crossTrainingFrom: "2026-09-29", speedStreams: true });
    const client = fakeClient(events, activities);

    await sync(db, client, "2026-10-21");

    expect(client.requests.filter((r) => r.startsWith("streams"))).toEqual(["streams i0", "streams i1", "streams i2", "streams walk", "streams lift"]);
    expect(loadActivities(db).find((a) => a.id === "i2")!.streams).toEqual(streamsResponse("i2"));
    expect(loadCrossTraining(db).find((a) => a.id === "lift")!.streams).toEqual(streamsResponse("lift"));
    await sync(db, client, "2026-10-21");
    expect(client.requests.filter((r) => r.startsWith("streams"))).toHaveLength(5);
  });

  it("stores non-running workouts as Cross-Training with raw responses, never as Activities", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    expect(loadCrossTraining(db)).toEqual([
      { id: "walk", date: "2026-09-30", type: "Walk", name: "Everett Walk", movingTime: 2400, raw: activities[3], streams: streamsResponse("walk") },
      { id: "lift", date: "2026-10-01", type: "WeightTraining", name: "Everett WeightTraining", movingTime: 2400, raw: activities[4], streams: streamsResponse("lift") },
    ]);
    expect(loadActivities(db).map((a) => a.id)).not.toContain("walk");
  });

  it("drops Cross-Training that intervals.icu no longer returns", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events, activities.slice(0, 4)), "2026-10-02");
    expect(loadCrossTraining(db).map((a) => a.id)).toEqual(["walk"]);
  });

  it("stores Cross-Training whose streams request fails as without streams, still succeeding, and does not ask again", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, activities);
    const streams = client.streams;
    client.streams = async (id) => {
      if (id === "lift") {
        client.requests.push(`streams ${id}`);
        throw new Error("intervals.icu activity/lift/streams failed: 404");
      }
      return streams(id);
    };

    await sync(db, client, "2026-10-02");

    expect(loadCrossTraining(db).find((a) => a.id === "lift")!.streams).toEqual([]);
    expect(loadSyncStatus(db)).toMatchObject({ error: null });
    expect(client.requests.filter((r) => r === "streams lift")).toHaveLength(1);
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
    expect(client.requests.filter((r) => !r.startsWith("intervals") && !r.startsWith("streams"))).toEqual([
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
      "streams i1",
      "streams i2",
      "streams walk",
      "streams lift",
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

  it("stores the intervals.icu Threshold Pace, Max HR and LTHR from the athlete's Run settings", async () => {
    const db = openDb(":memory:");
    expect(loadAthleteSettings(db)).toEqual({ runThresholdPace: null, maxHr: null, lthr: null });
    await sync(db, fakeClient(events, activities), "2026-10-02");
    expect(loadAthleteSettings(db)).toEqual({ runThresholdPace: 4.47, maxHr: 201, lthr: 181 });
  });

  it("clears the intervals.icu Threshold Pace, Max HR and LTHR, and still succeeds, when the athlete request fails", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events, activities, new Error("intervals.icu athlete failed: 500")), "2026-10-03");
    expect(loadAthleteSettings(db)).toEqual({ runThresholdPace: null, maxHr: null, lthr: null });
    expect(loadSyncStatus(db)).toMatchObject({ error: null, syncedThrough: "2026-10-03" });
  });

  it("clears the intervals.icu Threshold Pace, Max HR and LTHR once Run has none", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    await sync(db, fakeClient(events, activities, { sportSettings: [] }), "2026-10-03");
    expect(loadAthleteSettings(db)).toEqual({ runThresholdPace: null, maxHr: null, lthr: null });
  });

  it("records a sync that found no [NSM] Planned Workout without a synced-through date", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient([events[0]!], activities), "2026-10-02");
    expect(loadSyncStatus(db)).toMatchObject({ error: null, succeededAt: expect.any(String), syncedThrough: null });
  });
});

describe("sync after an upgrade", () => {
  /** Synced through 20 Oct 2026 before Cross-Training was, so the walk and lift of 30 Sep and 1 Oct are not stored. */
  function syncedBeforeCrossTraining() {
    const db = openDb(":memory:");
    saveSync(
      db,
      { from: "2026-09-29", to: "2026-11-17" },
      events.slice(1, 3),
      activities.slice(1, 3),
      new Map(),
      { finishedAt: "2026-10-20T12:00:00.000Z", syncedThrough: "2026-10-20" },
      new Map([
        ["i1", streamsWithoutSpeed("i1")],
        ["i2", streamsWithoutSpeed("i2")],
      ]),
    );
    return db;
  }
  const lateWalk = activity("late-walk", "2026-10-25", "Walk");

  it("stores every Cross-Training workout from the first day of stored history, with its streams, once", async () => {
    const db = syncedBeforeCrossTraining();
    const client = fakeClient(events, [...activities, lateWalk]);

    await sync(db, client, "2026-10-26");

    expect(client.requests).toContain("activities 2026-09-29..2026-10-27");
    expect(loadCrossTraining(db).map((a) => [a.id, a.streams])).toEqual([
      ["walk", streamsResponse("walk")],
      ["lift", streamsResponse("lift")],
      ["late-walk", streamsResponse("late-walk")],
    ]);

    const next = fakeClient(events, [...activities, lateWalk]);
    await sync(db, next, "2026-10-27");
    expect(next.requests.filter((r) => r.startsWith("activities"))).toEqual(["activities 2026-10-19..2026-10-28"]);
    expect(loadCrossTraining(db).map((a) => a.id)).toEqual(["walk", "lift", "late-walk"]);
  });

  it("leaves running Activities and Planned Workouts from before the re-fetched window as they were", async () => {
    const db = syncedBeforeCrossTraining();
    const before = { planned: loadPlannedWorkouts(db), activities: loadActivities(db).map(({ streams: _, ...a }) => a) };
    const client = fakeClient(events, [...activities, lateWalk]);

    await sync(db, client, "2026-10-26");

    expect(client.requests.filter((r) => r.startsWith("events") || r.startsWith("intervals"))).toEqual(["events 2026-10-13..2026-11-23"]);
    expect({ planned: loadPlannedWorkouts(db), activities: loadActivities(db).map(({ streams: _, ...a }) => a) }).toEqual(before);
  });

  it("re-fetches, once, stored streams without a speed stream", async () => {
    const db = syncedBeforeCrossTraining();
    const client = fakeClient(events, activities);

    await sync(db, client, "2026-10-26");

    expect(loadActivities(db).map((a) => a.streams)).toEqual([streamsResponse("i1"), streamsResponse("i2")]);
    expect(client.requests.filter((r) => r === "streams i1" || r === "streams i2")).toEqual(["streams i1", "streams i2"]);

    // intervals.icu has no speed for some workouts, such as a lift, so theirs still have none after.
    for (const id of ["i1", "i2"]) saveStreams(db, id, streamsWithoutSpeed(id));
    const next = fakeClient(events, activities);
    await sync(db, next, "2026-10-27");
    expect(next.requests.filter((r) => r.startsWith("streams"))).toEqual([]);
  });
});

describe("sync of the Fitness starting point", () => {
  it("stores intervals.icu's Fitness and Fatigue for the day before stored history, once", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-02");
    expect(client.requests.filter((r) => r.startsWith("wellness"))).toEqual(["wellness 2026-09-28"]);
    expect(loadFitnessStart(db)).toEqual({ date: "2026-09-28", fitness: 28.1, fatigue: 22.4 });

    const later = fakeClient(events, activities, undefined, undefined, (date) => ({ id: date, ctl: 99, atl: 99 }));
    await sync(db, later, "2026-10-03");
    expect(later.requests.filter((r) => r.startsWith("wellness"))).toEqual([]);
    expect(loadFitnessStart(db)).toEqual({ date: "2026-09-28", fitness: 28.1, fatigue: 22.4 });
  });

  it("stores none, still succeeding, when the wellness request fails or has no Fitness, and asks again next time", async () => {
    const db = openDb(":memory:");
    const failing = () => {
      throw new Error("intervals.icu wellness failed: 500");
    };
    await sync(db, fakeClient(events, activities, undefined, undefined, failing), "2026-10-02");
    expect(loadFitnessStart(db)).toBeNull();
    expect(loadSyncStatus(db)).toMatchObject({ error: null, syncedThrough: "2026-10-02" });

    await sync(db, fakeClient(events, activities, undefined, undefined, (date) => ({ id: date, ctl: null, atl: null })), "2026-10-03");
    expect(loadFitnessStart(db)).toBeNull();

    await sync(db, fakeClient(events, activities), "2026-10-04");
    expect(loadFitnessStart(db)).toEqual({ date: "2026-09-28", fitness: 28.1, fatigue: 22.4 });
  });

  it("keeps the stored one when stored history now starts later than it is for", async () => {
    const db = openDb(":memory:");
    saveFitnessStart(db, { date: "2026-09-20", fitness: 30, fatigue: 25 });
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-02");
    expect(client.requests.filter((r) => r.startsWith("wellness"))).toEqual([]);
    expect(loadFitnessStart(db)).toEqual({ date: "2026-09-20", fitness: 30, fatigue: 25 });
  });

  it("fetches a new one when stored history now starts earlier than the stored one is for", async () => {
    const db = openDb(":memory:");
    saveFitnessStart(db, { date: "2026-10-05", fitness: 30, fatigue: 25 });
    const client = fakeClient(events, activities);
    await sync(db, client, "2026-10-06");
    expect(client.requests.filter((r) => r.startsWith("wellness"))).toEqual(["wellness 2026-09-28"]);
    expect(loadFitnessStart(db)).toEqual({ date: "2026-09-28", fitness: 28.1, fatigue: 22.4 });
  });
});

describe("refetchActivity", () => {
  /** Synced on 2 Oct 2026, so a sync in November would no longer re-fetch any of it. */
  async function synced() {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, activities), "2026-10-02");
    return db;
  }
  const fixedReps = { analyzed: "2026-11-20T10:00:00Z", icu_intervals: [{ type: "WORK", moving_time: 360, gap: 3.3, average_heartrate: 166 }] };

  it("reloads one Quality Run's Activity, its intervals and its streams, whatever its age, and nothing else", async () => {
    const db = await synced();
    const plannedBefore = loadPlannedWorkouts(db);
    const renamed = activities.map((a) => (a.id === "i2" ? { ...a, name: "Fixed reps" } : { ...a, name: "Changed" }));
    const client = fakeClient(events, renamed, undefined, () => fixedReps);

    expect(await refetchActivity(db, client, "i2")).toBe("Updated");

    expect(client.requests).toEqual(["activity i2", "intervals i2", "streams i2"]);
    expect(loadActivities(db).map((a) => [a.id, a.name, a.intervals, a.streams])).toEqual([
      ["i1", "Everett - Easy Run", null, streamsResponse("i1")],
      ["i2", "Fixed reps", fixedReps, streamsResponse("i2")],
    ]);
    expect(loadPlannedWorkouts(db)).toEqual(plannedBefore);
  });

  it("reloads an Easy Run's streams", async () => {
    const db = await synced();
    const client = fakeClient(events, activities);

    expect(await refetchActivity(db, client, "i1")).toBe("NotQualityRun");

    expect(client.requests).toEqual(["activity i1", "streams i1"]);
    expect(loadActivities(db).find((a) => a.id === "i1")!.streams).toEqual(streamsResponse("i1"));
  });

  it("leaves stored data as it was when a request to intervals.icu fails", async () => {
    const db = await synced();
    const before = loadActivities(db);
    const client = fakeClient(events, activities, undefined, () => {
      throw new Error("intervals.icu activity/i2/intervals failed: 500");
    });

    await expect(refetchActivity(db, client, "i2")).rejects.toThrow("failed: 500");

    expect(loadActivities(db)).toEqual(before);
  });

  it("removes an Activity that no longer exists on intervals.icu", async () => {
    const db = await synced();

    expect(await refetchActivity(db, fakeClient(events, []), "i2")).toBe("Deleted");

    expect(loadActivities(db).map((a) => a.id)).toEqual(["i1"]);
  });

  it("stores an Activity no longer Matched to a Quality Run without its intervals", async () => {
    const db = openDb(":memory:");
    const plan = [event(1, "2026-09-29", "Easy Run"), event(2, "2026-09-30", "4 x 6:00 at 163–177 bpm")];
    const run = activity("i2", "2026-09-30", "Run", { paired_event_id: 2 });
    await sync(db, fakeClient(plan, [run]), "2026-10-02");
    const client = fakeClient(plan, [{ ...run, paired_event_id: 1 }]);

    expect(await refetchActivity(db, client, "i2")).toBe("NotQualityRun");

    expect(client.requests).toEqual(["activity i2", "streams i2"]);
    expect(loadActivities(db).map((a) => [a.id, a.pairedEventId, a.intervals, a.streams])).toEqual([
      ["i2", 1, null, streamsResponse("i2")],
    ]);
  });
});

describe("sync and pushed Week Plans", () => {
  // This app pushed an Easy Run for Thursday 5 Nov 2026; today is Tuesday 3 Nov.
  const pushedEvent = event(500, "2026-11-05", "Easy Run", "- 45m 62-70% HR hr=1s\n[NSM]", { external_id: "nsmpv-2026-11-05" });
  const easy = { kind: "Easy Run", duration: 2700 } as const;
  const plan = (version = eventVersion(pushedEvent)): StoredWeekPlan => ({
    week: "2026-11-02",
    days: Array.from({ length: 7 }, (_, i) => (i === 3 ? easy : { kind: "Rest" as const })),
    pushed: { "2026-11-05": { day: easy, eventId: "500", version } },
    pushedAt: "2026-11-01T12:00:00.000Z",
    changedOnIntervals: false,
  });
  const changed = (db: ReturnType<typeof openDb>) => loadWeekPlan(db, "2026-11-02")!.changedOnIntervals;

  it("leaves a Week Plan Pushed while its workouts are as pushed", async () => {
    const db = openDb(":memory:");
    saveWeekPlan(db, plan());
    await sync(db, fakeClient([...events, pushedEvent], activities), "2026-11-03");
    expect(changed(db)).toBe(false);
  });

  it("flags a Week Plan Changed on intervals.icu when a pushed workout was edited there", async () => {
    const db = openDb(":memory:");
    saveWeekPlan(db, plan());
    await sync(db, fakeClient([...events, { ...pushedEvent, description: "- 60m 62-70% HR hr=1s\n[NSM]" }], activities), "2026-11-03");
    expect(changed(db)).toBe(true);
  });

  it("flags a Week Plan Changed on intervals.icu when a pushed workout was deleted there", async () => {
    const db = openDb(":memory:");
    saveWeekPlan(db, plan());
    await sync(db, fakeClient(events, activities), "2026-11-03");
    expect(changed(db)).toBe(true);
  });

  it("ignores a pushed workout whose day has passed, as an Activity being paired with it", async () => {
    const db = openDb(":memory:");
    saveWeekPlan(db, plan());
    await sync(db, fakeClient([...events, { ...pushedEvent, name: "Easy Run (done)" }], activities), "2026-11-06");
    expect(changed(db)).toBe(false);
  });
});

/** A Garmin client giving each of `answers` in turn, the last one from then on; an Error fails that read. */
function fakeGarmin(...answers: (RunningThresholds | Error)[]): GarminClient & { reads: number } {
  const garmin = {
    reads: 0,
    async runningThresholds() {
      const answer = answers[Math.min(garmin.reads++, answers.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return garmin;
}

describe("sync of running thresholds from Garmin", () => {
  const events = [event(1, "2026-09-28", "Easy Run")];
  const athlete = () => ({ sportSettings: [{ types: ["Run"], threshold_pace: 4.47, max_hr: 197, lthr: 175 }] });
  const writes = (client: FakeClient) => client.requests.filter((r) => r.startsWith("sport-settings"));

  it("writes Garmin's running LTHR and Max HR to the Run settings when they differ, before storing them", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());

    await sync(db, client, "2026-10-02", fakeGarmin({ lthr: 173, maxHr: 194 }));

    expect(writes(client)).toEqual(['sport-settings Run {"lthr":173,"max_hr":194}']);
    expect(loadAthleteSettings(db)).toMatchObject({ lthr: 173, maxHr: 194 });
    expect(loadGarminSyncStatus(db)).toEqual({
      failure: null,
      lastChange: { at: expect.any(String), lthr: { from: 175, to: 173 }, maxHr: { from: 197, to: 194 } },
    });
  });

  it("writes only the threshold that changed", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());

    await sync(db, client, "2026-10-02", fakeGarmin({ lthr: 173, maxHr: 197 }));

    expect(writes(client)).toEqual(['sport-settings Run {"lthr":173}']);
    expect(loadGarminSyncStatus(db).lastChange).toMatchObject({ lthr: { from: 175, to: 173 }, maxHr: null });
  });

  it("writes nothing and records no change when they are already equal, keeping the latest change", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());
    const garmin = fakeGarmin({ lthr: 173, maxHr: 194 });
    await sync(db, client, "2026-10-02", garmin);
    const { lastChange } = loadGarminSyncStatus(db);

    await sync(db, client, "2026-10-03", garmin);

    expect(writes(client)).toHaveLength(1);
    expect(loadGarminSyncStatus(db)).toEqual({ failure: null, lastChange });
  });

  it("leaves the sync otherwise successful and writes nothing when Garmin fails", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());

    await sync(db, client, "2026-10-02", fakeGarmin(new GarminError("Unreachable", "Garmin failed: fetch failed")));

    expect(writes(client)).toEqual([]);
    expect(loadAthleteSettings(db)).toMatchObject({ lthr: 175, maxHr: 197 });
    expect(loadSyncStatus(db)).toMatchObject({ error: null, syncedThrough: "2026-10-02" });
    expect(loadGarminSyncStatus(db).lastChange).toBeNull();
  });

  it("records when Garmin started failing, and why, keeping that start through later failures", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());
    const garmin = fakeGarmin(
      new GarminError("KeyRejected", "Garmin failed: 401"),
      new GarminError("Unreachable", "Garmin failed: fetch failed"),
    );

    await sync(db, client, "2026-10-02", garmin);
    const first = loadGarminSyncStatus(db).failure;
    await sync(db, client, "2026-10-03", garmin);

    expect(first).toEqual({ kind: "KeyRejected", since: expect.any(String) });
    expect(loadGarminSyncStatus(db).failure).toEqual({ kind: "Unreachable", since: first!.since });
  });

  it("clears the failure once a sync reaches Garmin, whether or not anything changed", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());
    const garmin = fakeGarmin(new GarminError("KeyRejected", "Garmin failed: 401"), { lthr: 175, maxHr: 197 });

    await sync(db, client, "2026-10-02", garmin);
    await sync(db, client, "2026-10-03", garmin);

    expect(loadGarminSyncStatus(db)).toEqual({ failure: null, lastChange: null });
  });

  it("treats any other error from Garmin as an Unexpected failure", async () => {
    const db = openDb(":memory:");
    await sync(db, fakeClient(events, [], athlete()), "2026-10-02", fakeGarmin(new Error("boom")));
    expect(loadGarminSyncStatus(db).failure).toMatchObject({ kind: "Unexpected" });
  });

  it("does not ask Garmin when the intervals.icu Run settings could not be read", async () => {
    const db = openDb(":memory:");
    const garmin = fakeGarmin({ lthr: 173, maxHr: 194 });
    await sync(db, fakeClient(events, [], new Error("intervals.icu athlete failed: 500")), "2026-10-02", garmin);
    await sync(db, fakeClient(events, [], { sportSettings: [] }), "2026-10-03", garmin);
    expect(garmin.reads).toBe(0);
  });

  it("without a Garmin key, never asks Garmin nor writes to intervals.icu, and records nothing", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());
    await sync(db, client, "2026-10-02");
    expect(writes(client)).toEqual([]);
    expect(loadAthleteSettings(db)).toMatchObject({ lthr: 175, maxHr: 197 });
    expect(loadGarminSyncStatus(db)).toEqual({ failure: null, lastChange: null });
  });

  it("without a Garmin key, clears a failure recorded while there was one, keeping the latest change", async () => {
    const db = openDb(":memory:");
    const client = fakeClient(events, [], athlete());
    await sync(db, client, "2026-10-02", fakeGarmin({ lthr: 173, maxHr: 194 }));
    await sync(db, client, "2026-10-03", fakeGarmin(new GarminError("KeyRejected", "Garmin failed: 401")));
    const { lastChange } = loadGarminSyncStatus(db);

    await sync(db, client, "2026-10-04");

    expect(loadGarminSyncStatus(db)).toEqual({ failure: null, lastChange });
  });
});
