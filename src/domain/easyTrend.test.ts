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

const easyHrTarget = { low: 62, high: 70 };
/** With Max HR 200, the top of the Easy HR Target is 140 bpm. */
const MAX_HR = 200;
const MINUTE = 60;

/**
 * A run Matched to `name` whose streams give an Aerobic Decoupling of `aerobicDecoupling`%: steady heart rate, and its
 * grade-adjusted speed fading by that much from the first half to the second. `hr` gives each second's heart rate.
 */
function streamedRun(
  id: string,
  date: string,
  aerobicDecoupling: number,
  { minutes = 50, hr = () => 130 }: { minutes?: number; hr?: (second: number) => number } = {},
): EasyActivity {
  const seconds = minutes * MINUTE;
  const middle = (10 * MINUTE + seconds) / 2;
  const samples = Array.from({ length: seconds }, (_, i) => i);
  return {
    ...run(id, date, 3, 130),
    movingTime: seconds,
    streams: {
      time: samples,
      heartrate: samples.map(hr),
      cadence: samples.map(() => 85),
      velocity: samples.map(() => 3),
      gradeAdjustedVelocity: samples.map((s) => (s < middle ? 3 : 3 * (1 - aerobicDecoupling / 100))),
    },
  };
}

function easyPlanned(id: number, date: string, name = "Easy Run"): EasyPlannedWorkout {
  return { ...planned(id, date, name), easyHrTarget };
}

/** Matches each run to an Easy Run planned on its day. */
function trendOf(activities: EasyActivity[], names: Record<string, string> = {}) {
  const plan = activities.map((a, i) => easyPlanned(i + 1, a.date, names[a.id]));
  return easyTrend(plan, activities, "2026-10-24", MAX_HR);
}

describe("easyTrend's Aerobic Decoupling", () => {
  it("gives each Easy Run and Long Run its Aerobic Decoupling, or none when it has none", () => {
    const activities = [
      streamedRun("easy", "2026-10-19", 4),
      streamedRun("long", "2026-10-20", 2),
      streamedRun("short", "2026-10-21", 4, { minutes: 30 }),
      run("unstreamed", "2026-10-22", 3, 130),
    ];
    const runs = trendOf(activities, { long: "Long Run" }).runs;
    expect(runs.map((r) => [r.activityId, r.aerobicDecoupling === null ? null : Math.round(r.aerobicDecoupling)])).toEqual([
      ["easy", 4],
      ["long", 2],
      ["short", null],
      ["unstreamed", null],
    ]);
  });

  it("fits a straight line to the last 6 Training Weeks' runs of each Run Type", () => {
    // The window runs from Monday 2026-09-14 to today, 40 days later.
    const activities = [
      streamedRun("before", "2026-09-13", 50),
      streamedRun("day0", "2026-09-14", 2),
      streamedRun("day10", "2026-09-24", 4),
      streamedRun("day20", "2026-10-04", 6),
    ];
    const trend = trendOf(activities).aerobicDecouplingTrends["Easy Run"];
    expect(trend.from).toBe("2026-09-14");
    expect(trend.to).toBe("2026-10-24");
    expect(trend.line!.start).toBeCloseTo(2, 6);
    expect(trend.line!.end).toBeCloseTo(10, 6);
  });

  it("leaves Grey Zone Runs out of the line and counts them, and keeps Over Target runs in", () => {
    const activities = [
      streamedRun("day0", "2026-09-14", 2),
      streamedRun("day10", "2026-09-24", 4),
      // Above 140 bpm all the way: a Grey Zone Run.
      streamedRun("grey", "2026-09-29", 40, { hr: () => 150 }),
      streamedRun("day20", "2026-10-04", 6),
      // Above 140 bpm for the first 10 of 50 minutes, 20%: Over Target, and on the line.
      streamedRun("over", "2026-10-14", 8, { hr: (s) => (s < 10 * MINUTE ? 150 : 130) }),
    ];
    const result = trendOf(activities);
    expect(result.runs.find((r) => r.activityId === "over")).toMatchObject({ overTarget: true, greyZone: false });
    const trend = result.aerobicDecouplingTrends["Easy Run"];
    expect(trend.greyZoneRuns).toBe(1);
    expect(trend.greyZoneRuns).toBe(result.easyPaceTrends["Easy Run"].greyZoneRuns);
    expect(trend.line!.start).toBeCloseTo(2, 6);
    expect(trend.line!.end).toBeCloseTo(10, 6);
  });

  it("skips runs without an Aerobic Decoupling, and is Not enough data below 3 runs", () => {
    const activities = [
      streamedRun("day0", "2026-09-14", 2),
      streamedRun("day10", "2026-09-24", 4),
      streamedRun("short", "2026-10-04", 6, { minutes: 30 }),
      streamedRun("long1", "2026-10-05", 6),
      streamedRun("long2", "2026-10-06", 6),
      streamedRun("long3", "2026-10-07", 6),
    ];
    const result = trendOf(activities, { long1: "Long Run", long2: "Long Run", long3: "Long Run" });
    expect(result.aerobicDecouplingTrends["Easy Run"].line).toBeNull();
    expect(result.aerobicDecouplingTrends["Long Run"].line).toEqual({ start: expect.closeTo(6, 6), end: expect.closeTo(6, 6) });
  });
});
