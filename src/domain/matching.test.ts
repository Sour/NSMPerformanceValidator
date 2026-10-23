import { describe, expect, it } from "vitest";
import { matchActivities, type Activity, type PlannedWorkout } from "./matching";

function planned(p: Partial<PlannedWorkout> & Pick<PlannedWorkout, "id" | "date">): PlannedWorkout {
  return { name: "Easy Run", pairedActivityId: null, ...p };
}

function activity(a: Partial<Activity> & Pick<Activity, "id" | "date">): Activity {
  return { type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, ...a };
}

describe("matchActivities", () => {
  it("uses intervals.icu's pairing", () => {
    const matches = matchActivities(
      [planned({ id: 1, date: "2026-10-12", name: "2 x 10:00 at 163–177 bpm" })],
      [activity({ id: "i1", date: "2026-10-12", pairedEventId: 1 })],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 1, activityId: "i1" }]);
  });

  it("falls back to the Planned Workout on the same day when unpaired", () => {
    const matches = matchActivities(
      [planned({ id: 2, date: "2026-10-13" })],
      [activity({ id: "i2", date: "2026-10-13", name: "Everett - Easy Run" })],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 2, activityId: "i2" }]);
  });

  it("never Matches walks, hikes or lifts, even when paired or on the same day", () => {
    const matches = matchActivities(
      [planned({ id: 3, date: "2026-10-10", name: "Long Run" })],
      [
        activity({ id: "hike", date: "2026-10-10", type: "Hike", movingTime: 11899 }),
        activity({ id: "walk", date: "2026-10-10", type: "Walk", pairedEventId: 3 }),
        activity({ id: "lift", date: "2026-10-10", type: "WeightTraining" }),
      ],
    );
    expect(matches).toEqual([]);
  });

  it("prefers the same-day run whose name contains the Planned Workout's name", () => {
    const matches = matchActivities(
      [planned({ id: 4, date: "2026-10-15" })],
      [
        activity({ id: "longer", date: "2026-10-15", name: "Everett Running", movingTime: 4000 }),
        activity({ id: "named", date: "2026-10-15", name: "Everett - Easy Run", movingTime: 2000 }),
      ],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 4, activityId: "named" }]);
  });

  it("otherwise prefers the longer of two same-day runs", () => {
    const matches = matchActivities(
      [planned({ id: 5, date: "2026-10-15" })],
      [
        activity({ id: "short", date: "2026-10-15", movingTime: 900 }),
        activity({ id: "long", date: "2026-10-15", movingTime: 3245 }),
      ],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 5, activityId: "long" }]);
  });

  it("uses pairing recorded on the Planned Workout's side", () => {
    const matches = matchActivities(
      [planned({ id: 6, date: "2026-10-03", name: "Long Run", pairedActivityId: "seattle" })],
      [
        activity({ id: "other", date: "2026-10-03", name: "Long Run", movingTime: 9000 }),
        activity({ id: "seattle", date: "2026-10-03", name: "Seattle Running" }),
      ],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 6, activityId: "seattle" }]);
  });

  it("treats a pairing to an unknown Planned Workout as unpaired", () => {
    const matches = matchActivities(
      [planned({ id: 7, date: "2026-10-20" })],
      [activity({ id: "i7", date: "2026-10-20", pairedEventId: 999 })],
    );
    expect(matches).toEqual([{ plannedWorkoutId: 7, activityId: "i7" }]);
  });

  it("Matches trail and virtual runs like any other run", () => {
    const matches = matchActivities(
      [planned({ id: 8, date: "2026-10-24", name: "Long Run" }), planned({ id: 9, date: "2026-10-25" })],
      [
        activity({ id: "trail", date: "2026-10-24", type: "TrailRun" }),
        activity({ id: "treadmill", date: "2026-10-25", type: "VirtualRun" }),
      ],
    );
    expect(matches).toEqual([
      { plannedWorkoutId: 8, activityId: "trail" },
      { plannedWorkoutId: 9, activityId: "treadmill" },
    ]);
  });
});
