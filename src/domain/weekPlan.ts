import { addDays } from "./localDate";
import { weekStart } from "./trainingWeek";

/**
 * One day of a Week Plan: a Quality Run, an Easy Run or Long Run of a planned duration, or a rest day. Times in seconds.
 * A Quality Run may have a Rep Pace Target, a plain pace in seconds per mile; one saved before there were none has none.
 */
export type WeekPlanDay =
  | {
      kind: "Quality Run";
      reps: number;
      repLength: number;
      recovery: number;
      warmUp: number;
      coolDown: number;
      repPaceTarget?: number;
    }
  | { kind: "Easy Run"; duration: number }
  | { kind: "Long Run"; duration: number }
  | { kind: "Rest" };

/** A Week Plan day that is a workout rather than rest. */
export type WorkoutDay = Exclude<WeekPlanDay, { kind: "Rest" }>;

/** A day's planned time in seconds; a Quality Run's has no recovery after its last Rep. */
export function plannedTime(day: WeekPlanDay): number {
  switch (day.kind) {
    case "Quality Run":
      return day.warmUp + day.reps * day.repLength + (day.reps - 1) * day.recovery + day.coolDown;
    case "Easy Run":
    case "Long Run":
      return day.duration;
    case "Rest":
      return 0;
  }
}

/** A Week Plan's total planned time in seconds. */
export function weekPlannedTime(days: WeekPlanDay[]): number {
  return days.reduce((sum, d) => sum + plannedTime(d), 0);
}

/** The planned time of a Week Plan's Reps in seconds. */
export function plannedRepTime(days: WeekPlanDay[]): number {
  return days.reduce((sum, d) => sum + (d.kind === "Quality Run" ? d.reps * d.repLength : 0), 0);
}

/** Planned Quality Share: the Reps' planned time as a whole percentage of the week's; null with no planned running. */
export function plannedQualityShare(days: WeekPlanDay[]): number | null {
  const total = weekPlannedTime(days);
  return total === 0 ? null : Math.round((plannedRepTime(days) / total) * 100);
}

/** A Week Plan day on its date, YYYY-MM-DD. */
export interface DatedDay {
  date: string;
  day: WeekPlanDay;
}

/** A Planned Workout already on the calendar as a Week Plan day; `nsmApp` when the NSM app made it rather than this app. */
export type CalendarWorkout = DatedDay & { nsmApp: boolean };

export interface WeekPlanStart {
  /** The Monday of the Training Week to plan. */
  week: string;
  /** The previous Training Week's Week Plan; null when it has none. */
  previousPlan: WeekPlanDay[] | null;
  /** The previous Training Week's [NSM] Planned Workouts. */
  previousWeekWorkouts: DatedDay[];
  /** The [NSM] Planned Workouts already in the Training Week to plan. */
  thisWeekWorkouts: CalendarWorkout[];
  /** Whether a day of the week can still be edited. */
  editable: (date: string) => boolean;
}

/** The seven dates of the Training Week starting `week`, a Monday. */
export function weekDates(week: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i));
}

/**
 * The days a new Week Plan starts with, Monday first. A week that already holds NSM-app workouts imports them;
 * otherwise it is a copy of the previous week's Week Plan or, without one, an import of the previous week's
 * Planned Workouts. Days that can no longer be edited keep what is on the calendar. Days without a workout are rest.
 */
export function startWeekPlan({ week, previousPlan, previousWeekWorkouts, thisWeekWorkouts, editable }: WeekPlanStart): WeekPlanDay[] {
  const dates = weekDates(week);
  const imported = (workouts: DatedDay[], monday: string) =>
    weekDates(monday).map((date) => workouts.find((w) => w.date === date)?.day ?? REST);
  const thisWeek = imported(thisWeekWorkouts, week);
  if (thisWeekWorkouts.some((w) => w.nsmApp)) return thisWeek;
  const base = previousPlan ?? imported(previousWeekWorkouts, addDays(week, -7));
  return dates.map((date, i) => (editable(date) ? base[i]! : thisWeek[i]!));
}

const REST: WeekPlanDay = { kind: "Rest" };

/** A day can be edited until it has passed; today only while nothing is Matched to it. */
export function dayEditable(date: string, today: string, todayMatched: boolean): boolean {
  return date > today || (date === today && !todayMatched);
}

/** The Mondays of the only Training Weeks that can be planned: the current one and the next. */
export function plannableWeeks(today: string): { current: string; next: string } {
  const current = weekStart(today);
  return { current, next: addDays(current, 7) };
}

/** What a push made of one day: its event in the plan destination, null for a rest day, and that event's version then. */
export interface PushedDay {
  day: WeekPlanDay;
  eventId: string | null;
  /** The plan destination's opaque version of the event as pushed, to tell when it is changed there; null for rest. */
  version: string | null;
}

/** Draft until pushed, then Pushed, Unpushed changes once edited since, or Changed on intervals.icu once edited there. */
export type WeekPlanStatus = "Draft" | "Pushed" | "Unpushed changes" | "Changed on intervals.icu";

/**
 * A Week Plan's status from its draft `days` (Monday first) and what has been pushed, by date. Only days that can still
 * be edited can differ from what was pushed.
 */
export function weekPlanStatus(
  week: string,
  days: WeekPlanDay[],
  pushed: Readonly<Record<string, PushedDay>>,
  changedOnIntervals: boolean,
  editable: (date: string) => boolean,
): WeekPlanStatus {
  if (Object.keys(pushed).length === 0) return "Draft";
  if (changedOnIntervals) return "Changed on intervals.icu";
  const unpushed = weekDates(week).some((date, i) => editable(date) && !sameDay(pushed[date]?.day, days[i]!));
  return unpushed ? "Unpushed changes" : "Pushed";
}

export function sameDay(a: WeekPlanDay | undefined, b: WeekPlanDay | undefined): boolean {
  return JSON.stringify(a && canonical(a)) === JSON.stringify(b && canonical(b));
}

/** A day with its fields in one fixed order, so equal days serialise alike. */
function canonical(day: WeekPlanDay): WeekPlanDay {
  switch (day.kind) {
    case "Quality Run":
      return {
        kind: day.kind,
        reps: day.reps,
        repLength: day.repLength,
        recovery: day.recovery,
        warmUp: day.warmUp,
        coolDown: day.coolDown,
        repPaceTarget: day.repPaceTarget,
      };
    case "Easy Run":
    case "Long Run":
      return { kind: day.kind, duration: day.duration };
    case "Rest":
      return { kind: day.kind };
  }
}
