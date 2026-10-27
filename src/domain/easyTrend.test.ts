import { describe, expect, it } from "vitest";
import { easyTrend, type EasyActivity, type EasyPlannedWorkout } from "./easyTrend";

function planned(id: number, date: string, name: string): EasyPlannedWorkout {
  return { id, date, name, pairedActivityId: null, easyHrTarget: null };
}

function run(id: string, date: string, easyGap: number | null, easyHr: number | null): EasyActivity {
  return { id, date, type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, easyGap, easyHr, streams: null };
}

describe("easyTrend", () => {
  it("leaves out Unplanned Runs, Quality Runs and runs Matched to a Planned Workout with no Run Type", () => {
    const plan = [planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm"), planned(2, "2026-10-21", "Strides")];
    const activities = [
      run("quality", "2026-10-19", 2.6, 150),
      run("strides", "2026-10-21", 2.4, 130),
      run("unplanned", "2026-10-22", 2.0, 122),
    ];
    expect(easyTrend(plan, activities, "2026-10-24", 200).runs).toEqual([]);
  });
});
