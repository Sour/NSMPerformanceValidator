import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heartRateCeiling, qualityRun, qualityRunFormat, type QualityRunFormat } from "../domain/qualityRun";
import { detectedIntervals } from "./intervals";

/** A recorded intervals.icu `GET /activity/{id}/intervals` response. */
function recorded(activityId: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/intervals/${activityId}.json`, import.meta.url), "utf8"));
}

function analyse(plannedName: string, activityId: string) {
  return qualityRun(qualityRunFormat(plannedName)!, detectedIntervals(recorded(activityId)), heartRateCeiling(plannedName));
}

describe("Rep identification against recorded intervals.icu responses", () => {
  it("excludes a warm-up blip detected as a work interval (21 Oct 2026, 4 x 6:00)", () => {
    const run = analyse("4 x 6:00 at 163–177 bpm", "i200027084");
    expect(run.reps.map((r) => r.movingTime)).toEqual([357, 363, 358, 367]);
    expect(run.complete).toBe(true);
  });

  it("is Incomplete when no work interval is near the planned Rep Length (30 Sep 2026, 4 x 6:00)", () => {
    const run = analyse("4 x 6:00 at 163–177 bpm", "i192057960");
    expect(run.reps).toEqual([]);
    expect(run.complete).toBe(false);
    expect(run.repGap).toBeNull();
    expect(run.repHr).toBeNull();
  });

  it("is Incomplete when fewer Reps than planned were run (14 Oct 2026, 3 of 4 x 6:00)", () => {
    const run = analyse("4 x 6:00 at 163–177 bpm", "i197266062");
    expect(run.reps).toHaveLength(3);
    expect(run.complete).toBe(false);
  });

  it("excludes a Rep cut more than 15% short (9 Oct 2026, 2:32 of a planned 3:00)", () => {
    const run = analyse("7 x 3:00 at 163–177 bpm", "i195559776");
    expect(run.reps.map((r) => r.movingTime)).toEqual([176, 182, 183, 183, 184, 186]);
    expect(run.complete).toBe(false);
  });

  it("excludes a stray few-second work interval (23 Oct 2026, 7 x 3:00)", () => {
    const run = analyse("7 x 3:00 at 163–177 bpm", "i200786739");
    expect(run.reps).toHaveLength(7);
    expect(run.reps.every((r) => r.movingTime === 180)).toBe(true);
    expect(run.complete).toBe(true);
  });

  it("computes Rep GAP and Rep HR from the Reps only, weighted by time (5 Oct 2026, 2 x 10:00)", () => {
    const run = analyse("2 x 10:00 at 163–177 bpm", "i193887058");
    expect(run.complete).toBe(true);
    expect(run.repGap).toBeCloseTo((3.119371 * 600 + 3.096033 * 606) / 1206, 6);
    expect(run.repHr).toBeCloseTo((171 * 600 + 172 * 606) / 1206, 6);
  });

  it("is not Over Target when a Rep only peaks above the ceiling (5 Oct 2026, peak 181 bpm, average 172)", () => {
    const run = analyse("2 x 10:00 at 163–177 bpm", "i193887058");
    expect(run.overTarget).toBe(false);
    expect(analyse("2 x 10:00 at 160–170 bpm", "i193887058").overTarget).toBe(true);
  });
});

describe("heartRateCeiling", () => {
  it("is the top of the heart-rate target in a Planned Workout's name", () => {
    expect(heartRateCeiling("4 x 6:00 at 163–177 bpm")).toBe(177);
    expect(heartRateCeiling("4 x 6:00 at 150-160 bpm")).toBe(160);
  });

  it("is null when the name gives no heart-rate target", () => {
    expect(heartRateCeiling("4 x 6:00")).toBeNull();
  });
});

describe("qualityRunFormat", () => {
  it("reads reps and Rep Length from a Quality Run's name", () => {
    expect(qualityRunFormat("4 x 6:00 at 163–177 bpm")).toEqual<QualityRunFormat>({ reps: 4, repLength: 360 });
    expect(qualityRunFormat("2 × 10:00")).toEqual<QualityRunFormat>({ reps: 2, repLength: 600 });
  });

  it("is null for other Planned Workouts", () => {
    expect(qualityRunFormat("Easy Run")).toBeNull();
  });
});
