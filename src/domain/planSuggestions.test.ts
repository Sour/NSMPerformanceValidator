import { describe, expect, it } from "vitest";
import type { EasyTrendRun } from "./easyTrend";
import { easyDiscipline, lthrChange, pullBack, qualityShare, thresholdPaceCheck, volumeStep } from "./planSuggestions";
import type { RepLengthRun } from "./repProgress";
import type { VolumeWeek } from "./weeklyVolume";
import type { WeekPlanDay } from "./weekPlan";

// Planning the Training Week of Monday 9 Nov 2026.
const week = "2026-11-09";

describe("pullBack", () => {
  const fourBySix: WeekPlanDay = { kind: "Quality Run", reps: 4, repLength: 360, recovery: 90, warmUp: 600, coolDown: 600 };
  const planned = { date: "2026-11-11", day: fourBySix };
  /** A Matched 4 × 6:00 Quality Run on `date`, Complete and within its target unless flagged. */
  const run = (date: string, flags: { overTarget?: boolean; incomplete?: boolean } = {}, repLength = 360) =>
    ({
      date,
      activityId: `a-${date}`,
      plannedWorkoutName: "4 x 6:00 at 163–177 bpm",
      format: { reps: 4, repLength },
      complete: !flags.incomplete,
      overTarget: flags.overTarget ?? false,
    }) as RepLengthRun;

  it("proposes one fewer Rep when 2 of the last 3 Quality Runs at the Rep Length were Over Target or Incomplete", () => {
    const runs = [run("2026-10-21"), run("2026-10-28", { overTarget: true }), run("2026-11-04", { incomplete: true })];
    const suggestion = pullBack(planned, runs, week);
    expect(suggestion).toMatchObject({
      id: "pull-back:2026-11-11:360",
      kind: "Pull back",
      date: "2026-11-11",
      proposal: { date: "2026-11-11", day: { ...fourBySix, reps: 3 } },
    });
    expect(suggestion!.message).toBe("Pull back to 3 × 6:00: 2 of your last 3 6:00 Quality Runs were Over Target or Incomplete.");
    expect(suggestion!.runs).toEqual([
      { activityId: "a-2026-10-21", date: "2026-10-21", name: "4 x 6:00 at 163–177 bpm", flags: [] },
      { activityId: "a-2026-10-28", date: "2026-10-28", name: "4 x 6:00 at 163–177 bpm", flags: ["Over Target"] },
      { activityId: "a-2026-11-04", date: "2026-11-04", name: "4 x 6:00 at 163–177 bpm", flags: ["Incomplete"] },
    ]);
  });

  it("reads only the last 3 before the week, at the same Rep Length", () => {
    const runs = [
      run("2026-10-07", { overTarget: true }),
      run("2026-10-14", { overTarget: true }),
      run("2026-10-21"),
      run("2026-10-28"),
      run("2026-10-30", { overTarget: true }, 180),
      run("2026-11-04", { overTarget: true }),
      run("2026-11-11", { overTarget: true }),
    ];
    expect(pullBack(planned, runs, week)).toBeNull();
  });

  it("does not trigger on 1 of 3", () => {
    expect(pullBack(planned, [run("2026-10-21"), run("2026-10-28"), run("2026-11-04", { overTarget: true })], week)).toBeNull();
  });

  it("needs 3 runs at the Rep Length", () => {
    expect(pullBack(planned, [run("2026-10-28", { overTarget: true }), run("2026-11-04", { incomplete: true })], week)).toBeNull();
  });

  it("never proposes fewer than 1 Rep", () => {
    const oneRep = { date: "2026-11-11", day: { ...fourBySix, reps: 1 } };
    const runs = [run("2026-10-21", { overTarget: true }), run("2026-10-28", { overTarget: true }), run("2026-11-04")];
    expect(pullBack(oneRep, runs, week)).toBeNull();
  });

  it("is only for a Quality Run", () => {
    expect(pullBack({ date: "2026-11-11", day: { kind: "Easy Run", duration: 2700 } }, [], week)).toBeNull();
  });
});

describe("easyDiscipline", () => {
  const lastWeek = "2026-11-02";
  const target = { low: 62, high: 70 };
  const easy = (date: string, flags: { overTarget?: boolean; greyZone?: boolean } = {}) =>
    ({
      activityId: `a-${date}`,
      date,
      name: "Everett Running",
      runType: "Easy Run",
      overTarget: flags.overTarget ?? flags.greyZone ?? false,
      greyZone: flags.greyZone ?? false,
    }) as EasyTrendRun;

  it("notes 1 Grey Zone Run in the last finished week, naming the day and the Easy HR Target", () => {
    const suggestion = easyDiscipline([easy("2026-11-03", { greyZone: true }), easy("2026-11-05")], lastWeek, target);
    expect(suggestion).toMatchObject({ id: "easy-discipline", kind: "Easy discipline", date: null, proposal: null });
    expect(suggestion!.message).toBe(
      "Keep easy days easy: in the last finished Training Week, the Tuesday run was a Grey Zone Run. Your Easy HR Target is 62–70% of Max HR.",
    );
    expect(suggestion!.runs).toEqual([{ activityId: "a-2026-11-03", date: "2026-11-03", name: "Everett Running", flags: ["Grey Zone Run"] }]);
  });

  it("notes 2 Over Target easy runs", () => {
    const suggestion = easyDiscipline([easy("2026-11-03", { overTarget: true }), easy("2026-11-08", { overTarget: true })], lastWeek, target);
    expect(suggestion!.message).toBe(
      "Keep easy days easy: in the last finished Training Week, the Tuesday and Sunday runs were Over Target. Your Easy HR Target is 62–70% of Max HR.",
    );
    expect(suggestion!.runs.map((r) => r.flags)).toEqual([["Over Target"], ["Over Target"]]);
  });

  it("says nothing of a single Over Target easy run, a clean week, or runs in other weeks", () => {
    expect(easyDiscipline([easy("2026-11-03", { overTarget: true }), easy("2026-11-05")], lastWeek, target)).toBeNull();
    expect(easyDiscipline([easy("2026-11-03"), easy("2026-11-05")], lastWeek, target)).toBeNull();
    expect(easyDiscipline([easy("2026-10-27", { greyZone: true }), easy("2026-11-09", { greyZone: true })], lastWeek, target)).toBeNull();
  });
});

describe("volumeStep", () => {
  const finished = (...hours: number[]) =>
    hours.map((h, i) => ({ start: `2026-10-${12 + 7 * i}`, total: { distance: 0, movingTime: h * 3600 } }) as VolumeWeek);

  it("warns when planned time is more than 10% above the last 3 finished weeks' average, with both numbers", () => {
    const suggestion = volumeStep(5.6 * 3600, finished(5, 4, 6));
    expect(suggestion).toMatchObject({ id: "volume-step", kind: "Volume step", date: null, proposal: null });
    expect(suggestion!.message).toBe("5:36 planned is 12% above the 5:00 you averaged over the last 3 weeks.");
  });

  it("does not warn at exactly 110% or below, or for a week that goes down", () => {
    expect(volumeStep(5.5 * 3600, finished(5, 4, 6))).toBeNull();
    expect(volumeStep(4 * 3600, finished(5, 4, 6))).toBeNull();
  });

  it("averages only the last 3 finished weeks, or fewer when that is all there is", () => {
    expect(volumeStep(5.6 * 3600, finished(1, 5, 4, 6))).not.toBeNull();
    expect(volumeStep(5.6 * 3600, finished(9, 5, 5, 5))).not.toBeNull();
    expect(volumeStep(5.6 * 3600, finished(5))!.message).toBe("5:36 planned is 12% above the 5:00 you averaged over the last week.");
    expect(volumeStep(5.5 * 3600, finished(5))).toBeNull();
  });

  it("compares against what was actually run, so a return after time off is flagged", () => {
    expect(volumeStep(5 * 3600, finished(5, 0, 0))!.message).toBe("5:00 planned is 200% above the 1:40 you averaged over the last 3 weeks.");
    expect(volumeStep(5 * 3600, finished(0, 0, 0))!.message).toBe("5:00 planned after 3 weeks with no running.");
  });

  it("does not warn with no finished weeks", () => {
    expect(volumeStep(5 * 3600, [])).toBeNull();
  });
});

describe("qualityShare", () => {
  it("warns more than 3 points from the target, saying which way", () => {
    expect(qualityShare(29, 25)).toMatchObject({
      id: "quality-share",
      kind: "Quality Share",
      message: "Planned Quality Share is 29%, heavy on quality against your 25% target.",
    });
    expect(qualityShare(21, 25)!.message).toBe("Planned Quality Share is 21%, light on quality against your 25% target.");
  });

  it("does not warn within 3 points", () => {
    expect(qualityShare(28, 25)).toBeNull();
    expect(qualityShare(22, 25)).toBeNull();
    expect(qualityShare(25, 25)).toBeNull();
  });

  it("follows a changed target", () => {
    expect(qualityShare(25, 20)).not.toBeNull();
    expect(qualityShare(21, 20)).toBeNull();
  });

  it("says nothing for a week with no planned running", () => {
    expect(qualityShare(null, 25)).toBeNull();
  });
});

describe("thresholdPaceCheck", () => {
  /** A pace given in seconds per km, as metres per second. */
  const perKm = (seconds: number) => 1000 / seconds;

  it("notes an intervals.icu Threshold Pace more than 5 s/km from LT2 Pace, showing both", () => {
    const suggestion = thresholdPaceCheck(perKm(300), perKm(306));
    expect(suggestion).toMatchObject({ id: "threshold-pace", kind: "Threshold check", date: null, proposal: null });
    expect(suggestion!.message).toBe(
      "LT2 Pace 8:03 /mi is 6 s/km faster than your intervals.icu Threshold Pace 8:12 /mi; update it in intervals.icu.",
    );
    expect(thresholdPaceCheck(perKm(306), perKm(300))!.message).toContain("6 s/km slower");
  });

  it("says nothing at 5 s/km or less", () => {
    expect(thresholdPaceCheck(perKm(300), perKm(305))).toBeNull();
    expect(thresholdPaceCheck(perKm(300), perKm(296))).toBeNull();
  });

  it("says nothing when LT2 Pace is Not enough data or no Threshold Pace is set", () => {
    expect(thresholdPaceCheck(null, perKm(320))).toBeNull();
    expect(thresholdPaceCheck(perKm(300), null)).toBeNull();
  });
});

describe("lthrChange", () => {
  const previousWeek = [
    { id: 1, date: "2026-11-02", name: "2 x 10:00 at 163–177 bpm", pairedActivityId: null },
    { id: 2, date: "2026-11-03", name: "Easy Run", pairedActivityId: null },
  ];

  it("notes an LTHR that changed from the previous week's Planned Workouts", () => {
    expect(lthrChange(184, previousWeek)).toMatchObject({
      id: "lthr-change",
      kind: "Threshold check",
      message: "Targets now use LTHR 184 (was 181).",
    });
  });

  it("says nothing while LTHR is the same in whole bpm, without LTHR, or without a previous Quality Run", () => {
    expect(lthrChange(181, previousWeek)).toBeNull();
    expect(lthrChange(181.4, previousWeek)).toBeNull();
    expect(lthrChange(182, previousWeek)!.message).toBe("Targets now use LTHR 182 (was 181).");
    expect(lthrChange(null, previousWeek)).toBeNull();
    expect(lthrChange(184, previousWeek.slice(1))).toBeNull();
  });
});
