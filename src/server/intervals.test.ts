import { describe, expect, it } from "vitest";
import { plannedRecovery } from "./intervals";

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
