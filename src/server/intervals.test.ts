import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WeekPlanDay } from "../domain/weekPlan";
import { activityAverages, plannedRecovery, runLthr, runThresholdPace, weekPlanDay, type IntervalsEvent } from "./intervals";

describe("activityAverages", () => {
  it("is an Activity's whole-run Easy GAP and Easy HR", () => {
    expect(activityAverages({ gap: 2.36, average_heartrate: 139 })).toEqual({ easyGap: 2.36, easyHr: 139 });
  });

  it("treats a missing or zero GAP, as on a treadmill without a foot pod, as not recorded", () => {
    expect(activityAverages({ gap: 0, average_heartrate: 139 })).toEqual({ easyGap: null, easyHr: 139 });
    expect(activityAverages({})).toEqual({ easyGap: null, easyHr: null });
  });
});

/** The workout_doc of a recorded "4 x 6:00 at 163–177 bpm" Planned Workout, without its zone and load totals. */
const fourBySix = {
  steps: [
    { hr: { end: 70, start: 62, units: "%hr", target: "1s" }, warmup: true, duration: 900, intensity: "warmup" },
    {
      reps: 4,
      text: "4x",
      steps: [
        { hr: { end: 98, start: 90, units: "%lthr", target: "1s" }, duration: 360, intensity: "active" },
        { duration: 90, intensity: "recovery" },
      ],
      distance: 0,
      duration: 1800,
    },
    { hr: { end: 70, start: 62, units: "%hr", target: "1s" }, cooldown: true, duration: 900, intensity: "cooldown" },
  ],
  duration: 3600,
};

describe("plannedRecovery", () => {
  it("is the recovery between Reps in a Planned Workout's structure (4 x 6:00 with 1:30 recoveries)", () => {
    expect(plannedRecovery({ workout_doc: fourBySix })).toBe(90);
  });

  it("is null for a Planned Workout without repeated steps or without a structure", () => {
    expect(plannedRecovery({ workout_doc: { steps: [{ duration: 2700, intensity: "active" }] } })).toBeNull();
    expect(plannedRecovery({ workout_doc: null })).toBeNull();
    expect(plannedRecovery({})).toBeNull();
  });
});

/** A recorded intervals.icu `GET /athlete/{id}` response, trimmed to the sport settings' thresholds and units. */
const athlete = JSON.parse(readFileSync(new URL("./fixtures/intervals/athlete.json", import.meta.url), "utf8")) as {
  sportSettings: unknown[];
};

describe("runLthr", () => {
  it("is the Run sport's LTHR, not another sport's", () => {
    expect(runLthr(athlete)).toBe(181);
  });

  it("is null for an athlete with no Run LTHR", () => {
    expect(runLthr({ sportSettings: [athlete.sportSettings[0]] })).toBeNull();
    expect(runLthr({ sportSettings: [{ types: ["Run"], lthr: null }] })).toBeNull();
    expect(runLthr(null)).toBeNull();
  });
});

describe("runThresholdPace", () => {
  it("is the Run sport's intervals.icu Threshold Pace, in metres per second though shown per mile (9:03 /mi)", () => {
    expect(runThresholdPace(athlete)).toBe(2.9665275);
  });

  it("is null when no sport covers Run, or Run has no intervals.icu Threshold Pace", () => {
    expect(runThresholdPace({ sportSettings: [athlete.sportSettings[0]] })).toBeNull();
    expect(runThresholdPace({ sportSettings: [{ types: ["Run"], threshold_pace: null }] })).toBeNull();
    expect(runThresholdPace({ sportSettings: [{ types: ["Run"], threshold_pace: 0 }] })).toBeNull();
    expect(runThresholdPace({})).toBeNull();
    expect(runThresholdPace(null)).toBeNull();
  });
});

/** A recorded week of the NSM app's Planned Workouts (26 Oct 2026), trimmed of load and zone totals. */
const nsmWeek = JSON.parse(readFileSync(new URL("./fixtures/intervals/nsm-week-2026-10-26.json", import.meta.url), "utf8")) as IntervalsEvent[];
const nsmEvent = (date: string) => nsmWeek.find((e) => e.start_date_local.startsWith(date))!;

describe("weekPlanDay", () => {
  it("imports an NSM-app Quality Run with its Format, recovery, warm-up and cool-down", () => {
    expect(weekPlanDay(nsmEvent("2026-10-26"))).toEqual<WeekPlanDay>({
      kind: "Quality Run",
      reps: 2,
      repLength: 600,
      recovery: 120,
      warmUp: 600,
      coolDown: 600,
    });
    expect(weekPlanDay(nsmEvent("2026-10-30"))).toMatchObject({ reps: 7, repLength: 180, recovery: 60 });
  });

  it("imports an NSM-app Easy Run and Long Run with their durations", () => {
    expect(weekPlanDay(nsmEvent("2026-10-27"))).toEqual<WeekPlanDay>({ kind: "Easy Run", duration: 47 * 60 });
    expect(weekPlanDay(nsmEvent("2026-10-31"))).toEqual<WeekPlanDay>({ kind: "Long Run", duration: 83 * 60 });
  });

  it("is null for a Planned Workout of no Run Type", () => {
    expect(weekPlanDay({ ...nsmEvent("2026-10-27"), name: "Marathon" })).toBeNull();
  });
});
