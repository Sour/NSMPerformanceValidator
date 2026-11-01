import { describe, expect, it } from "vitest";
import { addDays } from "./localDate";
import { dayEditable, plannableWeeks, plannedQualityShare, plannedRepTime, plannedTime, startWeekPlan, weekPlannedTime, type WeekPlanDay } from "./weekPlan";

const rest: WeekPlanDay = { kind: "Rest" };
const easy = (minutes: number): WeekPlanDay => ({ kind: "Easy Run", duration: minutes * 60 });
const long = (minutes: number): WeekPlanDay => ({ kind: "Long Run", duration: minutes * 60 });
const quality = (reps: number, repMinutes: number, recoverySeconds: number): WeekPlanDay => ({
  kind: "Quality Run",
  reps,
  repLength: repMinutes * 60,
  recovery: recoverySeconds,
  warmUp: 600,
  coolDown: 600,
});

describe("plannedTime", () => {
  it("of a Quality Run is warm-up + reps × Rep Length + (reps − 1) × recovery + cool-down (7 × 3:00, 1:00 rec)", () => {
    // 10:00 + 21:00 + 6:00 + 10:00
    expect(plannedTime(quality(7, 3, 60))).toBe(47 * 60);
  });

  it("of an Easy Run or Long Run is its duration, and of a rest day nothing", () => {
    expect(plannedTime(easy(47))).toBe(47 * 60);
    expect(plannedTime(long(83))).toBe(83 * 60);
    expect(plannedTime(rest)).toBe(0);
  });
});

describe("Planned Quality Share", () => {
  /** The NSM week the runner ran in October 2026: 2 × 10:00, 4 × 6:00 and 7 × 3:00 between easy days. */
  const typicalWeek = [quality(2, 10, 120), easy(47), quality(4, 6, 90), easy(47), quality(7, 3, 60), long(83), rest];

  it("is the Reps' planned time as a whole percentage of the week's planned time", () => {
    // Quality Runs 42:00 + 48:30 + 47:00, easy days 47 + 47 + 83: 314:30 in all; Reps 20 + 24 + 21 = 65:00.
    expect(weekPlannedTime(typicalWeek)).toBe(314 * 60 + 30);
    expect(plannedRepTime(typicalWeek)).toBe(65 * 60);
    expect(plannedQualityShare(typicalWeek)).toBe(21);
  });

  it("is null for a week with no planned running", () => {
    expect(weekPlannedTime([rest, rest, rest, rest, rest, rest, rest])).toBe(0);
    expect(plannedQualityShare([rest, rest, rest, rest, rest, rest, rest])).toBeNull();
  });
});

describe("startWeekPlan", () => {
  // Next Training Week, Monday 9 Nov 2026.
  const week = "2026-11-09";
  const previousWeek = "2026-11-02";
  const always = () => true;
  const previousPlan = [quality(2, 10, 120), easy(40), quality(4, 6, 90), easy(40), quality(7, 3, 60), long(80), rest];
  const nsmWorkouts = (monday: string) => [
    { date: monday, day: quality(3, 10, 120), nsmApp: true },
    { date: addDays(monday, 2), day: easy(50), nsmApp: true },
    { date: addDays(monday, 5), day: long(90), nsmApp: true },
  ];

  it("is a copy of the previous week's Week Plan when there is one", () => {
    const days = startWeekPlan({ week, previousPlan, previousWeekWorkouts: nsmWorkouts(previousWeek), thisWeekWorkouts: [], editable: always });
    expect(days).toEqual(previousPlan);
  });

  it("imports the previous week's [NSM] Planned Workouts when there is no Week Plan, with rest on days without one", () => {
    const days = startWeekPlan({ week, previousPlan: null, previousWeekWorkouts: nsmWorkouts(previousWeek), thisWeekWorkouts: [], editable: always });
    expect(days).toEqual([quality(3, 10, 120), rest, easy(50), rest, rest, long(90), rest]);
  });

  it("imports the week's own NSM-app workouts when it already holds some, even with a previous Week Plan", () => {
    const days = startWeekPlan({ week, previousPlan, previousWeekWorkouts: [], thisWeekWorkouts: nsmWorkouts(week), editable: always });
    expect(days).toEqual([quality(3, 10, 120), rest, easy(50), rest, rest, long(90), rest]);
  });

  it("keeps the days that can no longer be edited as they were planned", () => {
    // Today is Wednesday of the current week; Monday and Tuesday have passed.
    const editable = (date: string) => date >= addDays(week, 2);
    const planned = [{ date: week, day: quality(3, 10, 120), nsmApp: false }];
    const days = startWeekPlan({ week, previousPlan, previousWeekWorkouts: [], thisWeekWorkouts: planned, editable });
    expect(days).toEqual([quality(3, 10, 120), rest, ...previousPlan.slice(2)]);
  });

  it("is all rest with nothing to copy or import", () => {
    expect(startWeekPlan({ week, previousPlan: null, previousWeekWorkouts: [], thisWeekWorkouts: [], editable: always })).toEqual(
      Array.from({ length: 7 }, () => rest),
    );
  });
});

describe("dayEditable", () => {
  const today = "2026-11-04";

  it("is false for a day that has passed", () => {
    expect(dayEditable("2026-11-03", today, false)).toBe(false);
  });

  it("is true for today while nothing is Matched to it, and false once something is", () => {
    expect(dayEditable(today, today, false)).toBe(true);
    expect(dayEditable(today, today, true)).toBe(false);
  });

  it("is true for a day still to come", () => {
    expect(dayEditable("2026-11-05", today, false)).toBe(true);
  });
});

describe("plannableWeeks", () => {
  it("are the current Training Week and the next, by their Mondays", () => {
    expect(plannableWeeks("2026-11-04")).toEqual({ current: "2026-11-02", next: "2026-11-09" });
    expect(plannableWeeks("2026-11-08")).toEqual({ current: "2026-11-02", next: "2026-11-09" });
  });
});
