import { describe, expect, it } from "vitest";
import { activityAverages, plannedRecovery, runThresholdPace } from "./intervals";

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

/** A `GET /athlete/{id}` response shaped per intervals.icu's SportSettings schema, trimmed to the fields that matter. */
const athlete = {
  id: "i12345",
  sportSettings: [
    { id: 1, types: ["Ride", "VirtualRide"], ftp: 250, lthr: 170, threshold_pace: null, pace_units: null },
    { id: 2, types: ["Run", "VirtualRun", "TrailRun"], lthr: 181, threshold_pace: 4.47, pace_units: "MINS_MILE" },
  ],
};

describe("runThresholdPace", () => {
  it("is the Run sport's threshold pace, in metres per second whatever its display units", () => {
    expect(runThresholdPace(athlete)).toBe(4.47);
  });

  it("is null when no sport covers Run, or Run has no threshold pace", () => {
    expect(runThresholdPace({ sportSettings: [athlete.sportSettings[0]] })).toBeNull();
    expect(runThresholdPace({ sportSettings: [{ types: ["Run"], threshold_pace: null }] })).toBeNull();
    expect(runThresholdPace({ sportSettings: [{ types: ["Run"], threshold_pace: 0 }] })).toBeNull();
    expect(runThresholdPace({})).toBeNull();
    expect(runThresholdPace(null)).toBeNull();
  });
});
