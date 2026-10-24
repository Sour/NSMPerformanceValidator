import { describe, expect, it } from "vitest";
import { toActivity } from "../server/intervals";
import type { Activity, PlannedWorkout } from "./matching";
import { weeklyVolume, type VolumeActivity } from "./weeklyVolume";

function planned(id: number, date: string, name: string): PlannedWorkout {
  return { id, date, name, pairedActivityId: null };
}

function run(id: string, date: string, distance: number | null, a: Partial<Activity> = {}): VolumeActivity {
  return { id, date, type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, distance, ...a };
}

describe("weeklyVolume", () => {
  it("has one Training Week per Monday from the first Planned Workout's week through today's", () => {
    const weeks = weeklyVolume("2026-10-22", [planned(1, "2026-10-01", "Easy Run")], []);
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ["2026-09-28", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
      ["2026-10-12", "2026-10-18"],
      ["2026-10-19", "2026-10-25"],
    ]);
    expect(weeks[0]!.total).toEqual({ distance: 0, movingTime: 0 });
  });

  it("is empty before any Planned Workout", () => {
    expect(weeklyVolume("2026-10-22", [], [run("a", "2026-10-20", 8000)])).toEqual([]);
  });

  it("stacks each week by the Run Type of the Planned Workout each Activity Matched", () => {
    const plan = [
      planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm"),
      planned(2, "2026-10-20", "Easy Run"),
      planned(3, "2026-10-21", "Easy Run"),
      planned(4, "2026-10-24", "Long Run"),
    ];
    const activities = [
      run("q", "2026-10-19", 12000, { movingTime: 3600 }),
      run("e1", "2026-10-20", 8000, { movingTime: 2700 }),
      run("e2", "2026-10-21", 6000, { movingTime: 2000 }),
      run("l", "2026-10-24", 20000, { movingTime: 6600 }),
      run("extra", "2026-10-25", 5000, { movingTime: 1800 }),
    ];
    const [week] = weeklyVolume("2026-10-25", plan, activities);
    expect(week!.byRunType).toEqual({
      "Quality Run": { distance: 12000, movingTime: 3600 },
      "Easy Run": { distance: 14000, movingTime: 4700 },
      "Long Run": { distance: 20000, movingTime: 6600 },
      "Unplanned Run": { distance: 5000, movingTime: 1800 },
    });
    expect(week!.total).toEqual({ distance: 51000, movingTime: 16700 });
  });

  it("counts every running Activity and nothing else", () => {
    const activities = [
      run("trail", "2026-10-20", 7000, { type: "TrailRun" }),
      run("treadmill", "2026-10-21", 5000, { type: "VirtualRun" }),
      run("walk", "2026-10-22", 3000, { type: "Walk" }),
      run("no-distance", "2026-10-22", null, { movingTime: 600 }),
    ];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-19", "Long Run")], activities);
    expect(week!.total).toEqual({ distance: 12000, movingTime: 2400 * 2 + 600 });
  });

  it("puts a late Sunday run in Los Angeles in that Sunday's week, not the next", () => {
    // 23:30 on Sunday 25 Oct in Los Angeles is already Monday 26 Oct in UTC.
    const sunday = toActivity({
      id: "i1",
      start_date_local: "2026-10-25T23:30:00",
      type: "Run",
      name: "Late run",
      moving_time: 1800,
      distance: 5000,
      paired_event_id: null,
    });
    const weeks = weeklyVolume("2026-10-26", [planned(1, "2026-10-19", "Easy Run")], [{ ...sunday, distance: 5000 }]);
    expect(weeks.map((w) => [w.start, w.total.distance])).toEqual([
      ["2026-10-19", 5000],
      ["2026-10-26", 0],
    ]);
  });
});
