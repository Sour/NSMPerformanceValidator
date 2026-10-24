import { describe, expect, it } from "vitest";
import { easyTrend, type EasyActivity } from "./easyTrend";
import type { PlannedWorkout } from "./matching";

function planned(id: number, date: string, name: string): PlannedWorkout {
  return { id, date, name, pairedActivityId: null };
}

function run(id: string, date: string, easyGap: number | null, easyHr: number | null): EasyActivity {
  return { id, date, type: "Run", name: "Everett Running", movingTime: 2400, pairedEventId: null, easyGap, easyHr };
}

describe("easyTrend", () => {
  it("has every Matched Easy Run and Long Run with its GAP and average HR, oldest first", () => {
    const plan = [planned(2, "2026-10-24", "Long Run"), planned(1, "2026-10-20", "Easy Run")];
    const activities = [run("long", "2026-10-24", 2.2, 138), run("easy", "2026-10-20", 2.36, 139)];
    expect(easyTrend(plan, activities)).toEqual([
      { activityId: "easy", date: "2026-10-20", name: "Everett Running", runType: "Easy Run", easyGap: 2.36, easyHr: 139 },
      { activityId: "long", date: "2026-10-24", name: "Everett Running", runType: "Long Run", easyGap: 2.2, easyHr: 138 },
    ]);
  });

  it("leaves out Unplanned Runs, Quality Runs and runs Matched to a Planned Workout with no Run Type", () => {
    const plan = [planned(1, "2026-10-19", "2 x 10:00 at 163–177 bpm"), planned(2, "2026-10-21", "Strides")];
    const activities = [
      run("quality", "2026-10-19", 2.6, 150),
      run("strides", "2026-10-21", 2.4, 130),
      run("unplanned", "2026-10-22", 2.0, 122),
    ];
    expect(easyTrend(plan, activities)).toEqual([]);
  });

  it("keeps a run without GAP or heart rate, with them null", () => {
    const [easy] = easyTrend([planned(1, "2026-10-20", "Easy Run")], [run("no-hr", "2026-10-20", 2.3, null)]);
    expect(easy).toMatchObject({ activityId: "no-hr", easyGap: 2.3, easyHr: null });
  });
});
