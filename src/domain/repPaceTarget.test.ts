import { describe, expect, it } from "vitest";
import { lastRepPaceTargets, recentRepGaps } from "./repPaceTarget";
import type { RepLengthRun } from "./repProgress";
import type { DatedDay, WeekPlanDay } from "./weekPlan";

const quality = (repLength: number, repPaceTarget?: number, reps = 3, recovery = 60): WeekPlanDay => ({
  kind: "Quality Run",
  reps,
  repLength,
  recovery,
  warmUp: 600,
  coolDown: 600,
  ...(repPaceTarget !== undefined && { repPaceTarget }),
});

describe("lastRepPaceTargets", () => {
  it("is, per Rep Length, the Rep Pace Target of the latest Quality Run of that length that has one", () => {
    const days: DatedDay[] = [
      { date: "2026-10-26", day: quality(600, 430) },
      { date: "2026-11-02", day: quality(600, 425, 2, 120) },
      { date: "2026-11-04", day: quality(360, 410) },
      { date: "2026-11-06", day: quality(600) },
      { date: "2026-11-07", day: { kind: "Easy Run", duration: 2400 } },
    ];
    expect(lastRepPaceTargets(days)).toEqual({ 600: 425, 360: 410 });
  });

  it("is latest by date, whatever order the days come in", () => {
    const days: DatedDay[] = [
      { date: "2026-11-09", day: quality(600, 420) },
      { date: "2026-11-02", day: quality(600, 425) },
    ];
    expect(lastRepPaceTargets(days)).toEqual({ 600: 420 });
  });

  it("has nothing for a Rep Length never given a Rep Pace Target", () => {
    expect(lastRepPaceTargets([{ date: "2026-11-02", day: quality(180) }])).toEqual({});
    expect(lastRepPaceTargets([])).toEqual({});
  });
});

function run(date: string, repLength: number, extra: Partial<RepLengthRun> = {}): RepLengthRun {
  return {
    date,
    activityId: `i-${date}`,
    plannedWorkoutName: "",
    format: { reps: 3, repLength },
    complete: true,
    repsRun: 3,
    reps: [],
    repGap: 3.8,
    repHr: 165,
    efficiency: null,
    hrCeiling: 177,
    overTarget: false,
    recovery: 60,
    formatChange: null,
    intervalsChangedAt: null,
    ...extra,
  };
}

describe("recentRepGaps", () => {
  it("is, per Rep Length, the Rep GAP of the latest Complete Quality Run of that length, and whether it was Over Target", () => {
    const runs = [
      run("2026-10-20", 600, { repGap: 3.7 }),
      run("2026-10-27", 600, { repGap: 3.9, overTarget: true }),
      run("2026-10-29", 360, { repGap: 4.1 }),
    ];
    expect(recentRepGaps(runs)).toEqual({
      600: { date: "2026-10-27", repGap: 3.9, overTarget: true },
      360: { date: "2026-10-29", repGap: 4.1, overTarget: false },
    });
  });

  it("passes over Incomplete runs and runs without a Rep GAP", () => {
    const runs = [
      run("2026-10-20", 600, { repGap: 3.7 }),
      run("2026-10-27", 600, { complete: false, repGap: 4.0 }),
      run("2026-10-29", 600, { repGap: null }),
    ];
    expect(recentRepGaps(runs)).toEqual({ 600: { date: "2026-10-20", repGap: 3.7, overTarget: false } });
  });

  it("has nothing for a Rep Length without a Complete Quality Run", () => {
    expect(recentRepGaps([run("2026-10-27", 180, { complete: false })])).toEqual({});
  });
});
