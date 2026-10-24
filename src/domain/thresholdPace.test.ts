import { describe, expect, it } from "vitest";
import type { PlannedWorkout } from "./matching";
import { lt1Hr, lthr, paceAt, paceLine, type EasyPoint, type QualityPoint } from "./thresholdPace";

function planned(id: number, date: string, name: string): PlannedWorkout {
  return { id, date, name, pairedActivityId: null };
}

function quality(date: string, repHr: number | null, repGap: number | null, complete = true): QualityPoint {
  return { date, complete, repGap, repHr };
}

function easy(date: string, easyHr: number | null, easyGap: number | null): EasyPoint {
  return { date, easyGap, easyHr };
}

/** Four runs on the line GAP = 0.02 × HR − 0.5 m/s, in the Training Week of Monday 19 Oct 2026. */
const onTheLine = {
  quality: [quality("2026-10-20", 165, 2.8), quality("2026-10-22", 170, 2.9)],
  easy: [easy("2026-10-19", 140, 2.3), easy("2026-10-21", 145, 2.4)],
};

describe("lthr", () => {
  it("is read from the most recent Quality Run's heart-rate target, which is 90–98% of LTHR", () => {
    const plan = [
      planned(1, "2026-10-13", "4 x 6:00 at 150–160 bpm"),
      planned(2, "2026-10-20", "2 x 10:00 at 163–177 bpm"),
      planned(3, "2026-10-21", "Easy Run"),
    ];
    // 163 / 0.90 = 181.11 and 177 / 0.98 = 180.61
    expect(lthr(plan, "2026-10-23")).toBeCloseTo(180.86, 2);
  });

  it("ignores Quality Runs planned after today", () => {
    const plan = [planned(1, "2026-10-20", "2 x 10:00 at 163–177 bpm"), planned(2, "2026-10-27", "4 x 6:00 at 150–160 bpm")];
    expect(lthr(plan, "2026-10-23")).toBeCloseTo(180.86, 2);
  });

  it("is null when no Planned Workout names a heart-rate target", () => {
    expect(lthr([planned(1, "2026-10-20", "Easy Run"), planned(2, "2026-10-21", "Long Run")], "2026-10-23")).toBeNull();
  });
});

describe("lt1Hr", () => {
  it("is the runner's own LT1 HR when they set one", () => {
    expect(lt1Hr(181, 155)).toEqual({ bpm: 155, assumed: false });
  });

  it("is assumed to be 88% of LTHR otherwise", () => {
    const assumed = lt1Hr(180, null);
    expect(assumed.assumed).toBe(true);
    expect(assumed.bpm).toBeCloseTo(158.4, 10);
  });
});

describe("paceLine", () => {
  it("fits Rep GAP / Rep HR and Easy GAP / Easy HR, so LT2 Pace at an LTHR of 180 is 3.1 m/s", () => {
    const line = paceLine("2026-10-19", onTheLine.quality, onTheLine.easy);
    expect(paceAt(line!, 180)).toBeCloseTo(3.1, 10);
  });

  it("gives LT1 Pace at LT1 HR from the same line: 2.6 m/s at 155 bpm", () => {
    const line = paceLine("2026-10-19", onTheLine.quality, onTheLine.easy);
    expect(paceAt(line!, 155)).toBeCloseTo(2.6, 10);
  });

  it("uses only the Training Week and the five before it", () => {
    const old = [quality("2026-09-06", 175, 2.0), easy("2026-09-07", 120, 3.0)];
    const line = paceLine("2026-10-19", [...onTheLine.quality, old[0] as QualityPoint], [...onTheLine.easy, old[1] as EasyPoint]);
    expect(paceAt(line!, 180)).toBeCloseTo(3.1, 10);
  });

  it("includes the first day of the window and runs later in the week", () => {
    const line = paceLine(
      "2026-10-19",
      [quality("2026-09-14", 165, 2.8), quality("2026-10-25", 170, 2.9)],
      onTheLine.easy,
    );
    expect(paceAt(line!, 180)).toBeCloseTo(3.1, 10);
  });

  it("leaves out Incomplete Quality Runs and runs without GAP or heart rate", () => {
    const line = paceLine(
      "2026-10-19",
      [...onTheLine.quality, quality("2026-10-23", 175, 2.0, false), quality("2026-10-24", null, 2.0)],
      [...onTheLine.easy, easy("2026-10-24", 150, null)],
    );
    expect(paceAt(line!, 180)).toBeCloseTo(3.1, 10);
  });

  it("is Not enough data with fewer than two Complete Quality Runs", () => {
    expect(paceLine("2026-10-19", onTheLine.quality.slice(0, 1), onTheLine.easy)).toBeNull();
    expect(
      paceLine("2026-10-19", [onTheLine.quality[0]!, quality("2026-10-23", 175, 3.0, false)], onTheLine.easy),
    ).toBeNull();
  });

  it("is Not enough data with fewer than two Easy Runs or Long Runs", () => {
    expect(paceLine("2026-10-19", onTheLine.quality, onTheLine.easy.slice(0, 1))).toBeNull();
  });

  it("is Not enough data when pace does not get faster as heart rate rises", () => {
    const slower = [quality("2026-10-20", 165, 2.2), quality("2026-10-22", 170, 2.1)];
    expect(paceLine("2026-10-19", slower, onTheLine.easy)).toBeNull();
  });
});
