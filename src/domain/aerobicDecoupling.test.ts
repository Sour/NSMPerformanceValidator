import { describe, expect, it } from "vitest";
import { aerobicDecoupling } from "./aerobicDecoupling";
import type { ActivityStreams } from "./activityStreams";

/** One sample a second, running at `cadence` 85 unless a sample says otherwise. */
interface Sample {
  hr?: number | null;
  gap?: number | null;
  cadence?: number;
  velocity?: number;
}

function streams(samples: Sample[], { time }: { time?: number[] } = {}): ActivityStreams {
  return {
    time: time ?? samples.map((_, i) => i),
    heartrate: samples.map((s) => (s.hr === undefined ? 140 : s.hr)),
    cadence: samples.map((s) => s.cadence ?? 85),
    velocity: samples.map((s) => s.velocity ?? 3),
    gradeAdjustedVelocity: samples.map((s) => (s.gap === undefined ? 3 : s.gap)),
  };
}

/** `seconds` one-second samples, each from `sample(second)`. */
function run(seconds: number, sample: (second: number) => Sample = () => ({})): Sample[] {
  return Array.from({ length: seconds }, (_, i) => sample(i));
}

const MINUTE = 60;

describe("aerobicDecoupling", () => {
  it("is about 0% for a steady run", () => {
    expect(aerobicDecoupling(streams(run(50 * MINUTE)))).toBeCloseTo(0, 6);
  });

  it("is positive when heart rate rises at a constant speed", () => {
    // 10 minutes left out, then 20 minutes at 140 and 20 at 154: (3/140 − 3/154) ÷ (3/140) = 9.09%.
    const samples = run(50 * MINUTE, (s) => ({ hr: s < 30 * MINUTE ? 140 : 154 }));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(100 * (1 - 140 / 154), 1);
  });

  it("is positive when speed fades at a constant heart rate", () => {
    const samples = run(50 * MINUTE, (s) => ({ gap: s < 30 * MINUTE ? 3 : 2.85 }));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(5, 1);
  });

  it("can be negative", () => {
    const samples = run(50 * MINUTE, (s) => ({ gap: s < 30 * MINUTE ? 3 : 3.15 }));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(-5, 1);
  });

  it("leaves out the first 10 minutes of moving time", () => {
    const samples = run(50 * MINUTE, (s) => ({ hr: s < 10 * MINUTE ? 100 : 140 }));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(0, 6);
  });

  it("splits the rest into halves of equal moving time", () => {
    // 60 minutes: halves are 10–35 and 35–60. The heart rate step at 35 minutes falls exactly between them.
    const samples = run(60 * MINUTE, (s) => ({ hr: s < 35 * MINUTE ? 140 : 150 }));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(100 * (1 - 140 / 150), 1);
  });

  it("leaves stops out of moving time, whether cadence or speed shows them", () => {
    // A 10-minute stop at a high heart rate in the first half, half by cadence, half by speed, then 10 more minutes so
    // the halves stay 20 minutes of moving time each.
    const samples = run(60 * MINUTE, (s) => {
      if (s >= 20 * MINUTE && s < 25 * MINUTE) return { hr: 180, cadence: 0 };
      if (s >= 25 * MINUTE && s < 30 * MINUTE) return { hr: 180, velocity: 0, gap: 0 };
      return {};
    });
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(0, 6);
  });

  it("halves by moving time, not elapsed time", () => {
    // 60 minutes elapsed with a 10-minute stop from 20 to 30: moving time is 50 minutes, so the halves meet at 30 minutes
    // moving, 40 elapsed. Halving elapsed time would meet at 35 elapsed and mix the heart rate step into the first half.
    const samples = run(60 * MINUTE, (s) => {
      if (s >= 20 * MINUTE && s < 30 * MINUTE) return { cadence: 0 };
      return { hr: s < 40 * MINUTE ? 140 : 150 };
    });
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(100 * (1 - 140 / 150), 6);
  });

  it("leaves pauses in recording out of moving time", () => {
    // 30 minutes recorded, a 20-minute pause, then 20 more: 50 minutes of moving time and steady.
    const time = [...run(30 * MINUTE).map((_, i) => i), ...run(20 * MINUTE).map((_, i) => 50 * MINUTE + i)];
    expect(aerobicDecoupling(streams(run(50 * MINUTE), { time }))).toBeCloseTo(0, 6);
  });

  it("keeps Walk Breaks in", () => {
    // Walking for 2 minutes in the second half, slower per beat: it counts against the run.
    const samples = run(50 * MINUTE, (s) => (s >= 40 * MINUTE && s < 42 * MINUTE ? { cadence: 55, gap: 1.5 } : {}));
    expect(aerobicDecoupling(streams(samples))!).toBeGreaterThan(0);
  });

  it("is none with under 40 minutes of moving time", () => {
    expect(aerobicDecoupling(streams(run(40 * MINUTE - 1)))).toBeNull();
    expect(aerobicDecoupling(streams(run(40 * MINUTE + 1)))).not.toBeNull();
  });

  it("is none without a heart-rate or grade-adjusted speed stream", () => {
    expect(aerobicDecoupling({ ...streams(run(50 * MINUTE)), heartrate: null })).toBeNull();
    expect(aerobicDecoupling({ ...streams(run(50 * MINUTE)), gradeAdjustedVelocity: null })).toBeNull();
  });

  it("leaves samples without heart rate or grade-adjusted speed out of that half's average", () => {
    const samples = run(50 * MINUTE, (s) => (s >= 35 * MINUTE && s < 36 * MINUTE ? { hr: null, gap: null } : {}));
    expect(aerobicDecoupling(streams(samples))).toBeCloseTo(0, 6);
  });
});
