import { describe, expect, it } from "vitest";
import { toActivity } from "../server/intervals";
import type { Activity, PlannedWorkout } from "./matching";
import type { DetectedInterval } from "./qualityRun";
import { weeklyVolume, type VolumeActivity } from "./weeklyVolume";

function planned(id: number, date: string, name: string): PlannedWorkout {
  return { id, date, name, pairedActivityId: null };
}

function run(
  id: string,
  date: string,
  distance: number | null,
  a: Partial<Activity> = {},
  intervals: DetectedInterval[] | null = null,
): VolumeActivity {
  return { id, date, type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, distance, intervals, ...a };
}

function interval(type: string, movingTime: number, distance: number): DetectedInterval {
  return { type, movingTime, distance, gap: 3.3, averageHeartrate: 168 };
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

  it("splits each week into Quality Volume and Easy Volume, which sum to the week's total", () => {
    const plan = [
      planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm"),
      planned(2, "2026-10-20", "Easy Run"),
      planned(3, "2026-10-22", "Strides"),
      planned(4, "2026-10-24", "Long Run"),
    ];
    const activities = [
      run("q", "2026-10-19", 12000, { movingTime: 3600 }, [
        interval("WORK", 600, 2000),
        interval("RECOVERY", 120, 300),
        interval("WORK", 610, 2050),
        interval("WORK", 20, 120),
      ]),
      run("e", "2026-10-20", 8000, { movingTime: 2700 }),
      run("o", "2026-10-22", 4000, { movingTime: 1500 }),
      run("l", "2026-10-24", 20000, { movingTime: 6600 }),
      run("extra", "2026-10-25", 5000, { movingTime: 1800 }),
    ];
    const [week] = weeklyVolume("2026-10-25", plan, activities);
    expect(week!.quality).toEqual({ distance: 4050, movingTime: 1210 });
    expect(week!.easy).toEqual({ distance: 49000 - 4050, movingTime: 16200 - 1210 });
    expect(week!.total).toEqual({ distance: 49000, movingTime: 16200 });
  });

  it("counts a Rep beyond the planned rep count as Quality Volume", () => {
    const activities = [
      run("q", "2026-10-21", 10000, { movingTime: 3000 }, [
        interval("WORK", 360, 1200),
        interval("WORK", 360, 1200),
        interval("WORK", 365, 1210),
      ]),
    ];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-21", "2 x 6:00 at 163–177 bpm")], activities);
    expect(week!.quality).toEqual({ distance: 3610, movingTime: 1085 });
  });

  it("counts a Quality Run with no identified Reps entirely as Easy Volume", () => {
    const plan = [
      planned(1, "2026-10-19", "4 x 6:00 at 163–177 bpm"),
      planned(2, "2026-10-20", "4 x 6:00 at 163–177 bpm"),
      planned(3, "2026-10-21", "4 x 6:00 at 163–177 bpm"),
    ];
    const activities = [
      run("not-fetched", "2026-10-19", 9000, { movingTime: 3000 }),
      run("none-detected", "2026-10-20", 9000, { movingTime: 3000 }, []),
      run("none-fit", "2026-10-21", 9000, { movingTime: 3000 }, [interval("WORK", 240, 900)]),
    ];
    const [week] = weeklyVolume("2026-10-22", plan, activities);
    expect(week!.quality).toEqual({ distance: 0, movingTime: 0 });
    expect(week!.easy).toEqual({ distance: 27000, movingTime: 9000 });
  });

  it("never gives a run more Quality Volume than its own distance and time", () => {
    const activities = [
      run("q", "2026-10-21", null, { movingTime: 700 }, [interval("WORK", 360, 1200), interval("WORK", 360, 1200)]),
    ];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-21", "2 x 6:00 at 163–177 bpm")], activities);
    expect(week!.quality).toEqual({ distance: 0, movingTime: 700 });
    expect(week!.easy).toEqual({ distance: 0, movingTime: 0 });
  });

  it("counts the work intervals of a run that is not a Quality Run as Easy Volume", () => {
    const activities = [run("e", "2026-10-20", 8000, { movingTime: 2700 }, [interval("WORK", 360, 1200)])];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-20", "Easy Run")], activities);
    expect(week!.quality).toEqual({ distance: 0, movingTime: 0 });
    expect(week!.easy).toEqual({ distance: 8000, movingTime: 2700 });
  });

  it("gives the Quality Share and Easy Share of the week's moving time as whole percentages", () => {
    const activities = [
      run("q", "2026-10-19", 12000, { movingTime: 3600 }, [interval("WORK", 600, 2000), interval("WORK", 600, 2000)]),
      run("e", "2026-10-21", 8000, { movingTime: 2700 }),
    ];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm")], activities);
    expect([week!.qualityShare, week!.easyShare]).toEqual([19, 81]);
  });

  it("makes the Quality Share and Easy Share add up to 100 when each would round up", () => {
    // 1000 of 8000 seconds is 12.5% Quality and 87.5% Easy, which round to 13 and 88 on their own.
    const activities = [
      run("q", "2026-10-19", 12000, { movingTime: 4000 }, [interval("WORK", 500, 1700), interval("WORK", 500, 1700)]),
      run("e", "2026-10-21", 8000, { movingTime: 4000 }),
    ];
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-19", "2 x 8:20 at 163–177 bpm")], activities);
    expect([week!.qualityShare, week!.easyShare]).toEqual([13, 87]);
  });

  it("gives a week with no running neither share", () => {
    const [week] = weeklyVolume("2026-10-22", [planned(1, "2026-10-19", "Easy Run")], []);
    expect([week!.qualityShare, week!.easyShare]).toEqual([null, null]);
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
    const weeks = weeklyVolume("2026-10-26", [planned(1, "2026-10-19", "Easy Run")], [{ ...sunday, distance: 5000, intervals: null }]);
    expect(weeks.map((w) => [w.start, w.total.distance])).toEqual([
      ["2026-10-19", 5000],
      ["2026-10-26", 0],
    ]);
  });
});
