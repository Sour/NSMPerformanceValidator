import { describe, expect, it } from "vitest";
import type { Activity, PlannedWorkout } from "./matching";
import { trainingWeek, trainingWeekRange } from "./trainingWeek";

function planned(id: number, date: string, name: string, pairedActivityId: string | null = null): PlannedWorkout {
  return { id, date, name, pairedActivityId };
}

function runningActivity(id: string, date: string, a: Partial<Activity> = {}): Activity {
  return { id, date, type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, ...a };
}

// The week of 19 Oct 2026 as synced on Thursday 22 Oct.
const plan = [
  planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm"),
  planned(2, "2026-10-20", "Easy Run"),
  planned(3, "2026-10-21", "4 x 6:00 at 163–177 bpm"),
  planned(4, "2026-10-22", "Easy Run"),
  planned(5, "2026-10-23", "7 x 3:00 at 163–177 bpm"),
  planned(6, "2026-10-24", "Long Run"),
];

describe("trainingWeek", () => {
  it("runs Monday to Sunday around today", () => {
    const week = trainingWeek("2026-10-22", [planned(9, "2026-10-18", "Long Run"), ...plan], []);
    expect(week.start).toBe("2026-10-19");
    expect(week.end).toBe("2026-10-25");
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
    expect(week.days.flatMap((d) => d.workouts.map((w) => w.plannedWorkout.id))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("marks each Planned Workout Matched, Missed or Upcoming", () => {
    const activities = [
      runningActivity("i199098087", "2026-10-19", { pairedEventId: 1 }),
      runningActivity("hike", "2026-10-20", { type: "Hike" }),
      runningActivity("i200027084", "2026-10-21", { pairedEventId: 3 }),
    ];
    const week = trainingWeek("2026-10-22", plan, activities);
    const statuses = week.days.flatMap((d) => d.workouts.map((w) => [w.plannedWorkout.id, w.status, w.activity?.id]));
    expect(statuses).toEqual([
      [1, "Matched", "i199098087"],
      [2, "Missed", undefined],
      [3, "Matched", "i200027084"],
      [4, "Upcoming", undefined],
      [5, "Upcoming", undefined],
      [6, "Upcoming", undefined],
    ]);
  });

  it("gives each Planned Workout its Run Type", () => {
    const week = trainingWeek("2026-10-22", [...plan, planned(7, "2026-10-25", "Strides")], []);
    const runTypes = week.days.flatMap((d) => d.workouts.map((w) => w.runType));
    expect(runTypes).toEqual(["Quality Run", "Easy Run", "Quality Run", "Easy Run", "Quality Run", "Long Run", null]);
  });

  it("lists the week's running Activities without a Match as Unplanned Runs", () => {
    const activities = [
      runningActivity("paired", "2026-10-19", { pairedEventId: 1 }),
      runningActivity("double", "2026-10-19", { movingTime: 900 }),
      runningActivity("sunday", "2026-10-25"),
      runningActivity("last-week", "2026-10-18"),
      runningActivity("walk", "2026-10-21", { type: "Walk" }),
    ];
    const week = trainingWeek("2026-10-22", plan, activities);
    expect(week.unplannedRuns.map((a) => a.id)).toEqual(["double", "sunday"]);
  });
});

describe("trainingWeek for another date", () => {
  const activities = [runningActivity("i199098087", "2026-10-19", { pairedEventId: 1 }), runningActivity("sunday", "2026-10-25")];

  it("is the past Training Week containing that date, its unmatched Planned Workouts Missed", () => {
    const week = trainingWeek("2026-10-29", plan, activities, "2026-10-21");
    expect([week.start, week.end]).toEqual(["2026-10-19", "2026-10-25"]);
    const statuses = week.days.flatMap((d) => d.workouts.map((w) => [w.plannedWorkout.id, w.status]));
    expect(statuses).toEqual([
      [1, "Matched"],
      [2, "Missed"],
      [3, "Missed"],
      [4, "Missed"],
      [5, "Missed"],
      [6, "Missed"],
    ]);
    expect(week.unplannedRuns.map((a) => a.id)).toEqual(["sunday"]);
  });

  it("is an upcoming Training Week, its Planned Workouts Upcoming", () => {
    const week = trainingWeek("2026-10-14", plan, [], "2026-10-19");
    expect(week.start).toBe("2026-10-19");
    expect(week.days.flatMap((d) => d.workouts.map((w) => w.status))).toEqual(Array(6).fill("Upcoming"));
  });
});

describe("trainingWeekRange", () => {
  it("runs from the first Planned Workout's Training Week to the last one's", () => {
    const later = [planned(9, "2026-09-30", "Easy Run"), ...plan, planned(10, "2026-11-11", "Long Run")];
    expect(trainingWeekRange("2026-10-22", later)).toEqual({ earliest: "2026-09-28", latest: "2026-11-09" });
  });

  it("always includes this Training Week", () => {
    expect(trainingWeekRange("2026-11-04", plan)).toEqual({ earliest: "2026-10-19", latest: "2026-11-02" });
    expect(trainingWeekRange("2026-10-22", [])).toEqual({ earliest: "2026-10-19", latest: "2026-10-19" });
  });
});
