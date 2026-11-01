import type { EasyHrTarget, EasyTrendRun } from "./easyTrend";
import { addDays, dayOfWeek } from "./localDate";
import type { PlannedWorkout } from "./matching";
import { formatDuration, formatHoursMinutes, secondsPerMile } from "./pace";
import { heartRateTarget, qualityRunFormat } from "./qualityRun";
import type { RepLengthRun } from "./repProgress";
import { lthr as plannedLthr } from "./thresholdPace";
import type { VolumeWeek } from "./weeklyVolume";
import type { DatedDay } from "./weekPlan";

export type PlanSuggestionKind = "Pull back" | "Easy discipline" | "Volume step" | "Quality Share" | "Threshold check";

/** A run a Plan Suggestion is based on, with what it was flagged. */
export interface SuggestionRun {
  activityId: string;
  date: string;
  name: string;
  /** e.g. "Over Target", "Incomplete", "Grey Zone Run"; empty for a run that was fine. */
  flags: string[];
}

/** Advice on a Week Plan from recent progress, which the runner may accept or dismiss; it never blocks a push. */
export interface PlanSuggestion {
  /** Unique within a Training Week; dismissals are kept by it. */
  id: string;
  kind: PlanSuggestionKind;
  /** The day it is about; null for the whole week. */
  date: string | null;
  message: string;
  /** The change to the Week Plan that accepting it makes; null when it is information only. */
  proposal: DatedDay | null;
  runs: SuggestionRun[];
}

/** Quality Runs at a Rep Length that pull back reads, the most recent before the week. */
const PULL_BACK_RUNS = 3;
/** How many of them Over Target or Incomplete trigger a pull back. */
const PULL_BACK_SHORT = 2;

/**
 * Pull back for a Quality Run planned in the week starting `week`: when 2 of the last 3 Matched Quality Runs at its
 * Rep Length before the week were Over Target or Incomplete, one fewer Rep. Missed workouts have no Matched run, so
 * they never count. Null with fewer than 3 such runs, or for a 1-Rep Quality Run.
 */
export function pullBack({ date, day }: DatedDay, runs: RepLengthRun[], week: string): PlanSuggestion | null {
  if (day.kind !== "Quality Run" || day.reps <= 1) return null;
  const recent = runs
    .filter((r) => r.format.repLength === day.repLength && r.date < week)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-PULL_BACK_RUNS);
  if (recent.length < PULL_BACK_RUNS) return null;
  const flags = (r: RepLengthRun) => [...(r.overTarget ? ["Over Target"] : []), ...(r.complete ? [] : ["Incomplete"])];
  const short = recent.filter((r) => flags(r).length > 0).length;
  if (short < PULL_BACK_SHORT) return null;
  const repLength = formatDuration(day.repLength);
  return {
    id: `pull-back:${date}:${day.repLength}`,
    kind: "Pull back",
    date,
    message: `Pull back to ${day.reps - 1} × ${repLength}: ${short} of your last ${PULL_BACK_RUNS} ${repLength} Quality Runs were Over Target or Incomplete.`,
    proposal: { date, day: { ...day, reps: day.reps - 1 } },
    runs: recent.map((r) => ({ activityId: r.activityId, date: r.date, name: r.plannedWorkoutName, flags: flags(r) })),
  };
}

/** Over Target easy runs in a week that trigger easy discipline, without a Grey Zone Run. */
const EASY_OVER_TARGET_RUNS = 2;

/**
 * Easy discipline: the Easy Runs and Long Runs of the Training Week starting `lastWeek`, the last finished one, had a
 * Grey Zone Run or 2 Over Target runs. Information only.
 */
export function easyDiscipline(runs: EasyTrendRun[], lastWeek: string, easyHrTarget: EasyHrTarget | null): PlanSuggestion | null {
  const inWeek = runs.filter((r) => r.date >= lastWeek && r.date <= addDays(lastWeek, 6) && r.overTarget);
  const grey = inWeek.filter((r) => r.greyZone);
  if (grey.length === 0 && inWeek.length < EASY_OVER_TARGET_RUNS) return null;
  const over = inWeek.filter((r) => !r.greyZone);
  const part = (rs: EasyTrendRun[], one: string, many: string) =>
    `${listed(rs.map((r) => weekday(r.date)))} ${rs.length > 1 ? `runs were ${many}` : `run was ${one}`}`;
  const parts = [
    ...(grey.length > 0 ? [part(grey, "a Grey Zone Run", "Grey Zone Runs")] : []),
    ...(over.length > 0 ? [part(over, "Over Target", "Over Target")] : []),
  ];
  const target = easyHrTarget ? ` Your Easy HR Target is ${easyHrTarget.low}–${easyHrTarget.high}% of Max HR.` : "";
  return {
    id: "easy-discipline",
    kind: "Easy discipline",
    date: null,
    message: `Keep easy days easy: in the last finished Training Week, the ${parts.join(", and ")}.${target}`,
    proposal: null,
    runs: inWeek.map((r) => ({ activityId: r.activityId, date: r.date, name: r.name, flags: [r.greyZone ? "Grey Zone Run" : "Over Target"] })),
  };
}

/** Finished Training Weeks the volume step averages. */
const VOLUME_WEEKS = 3;
/** Planned time above this percentage of the average is a volume step. */
const VOLUME_STEP_PERCENT = 110;

/**
 * Volume step: `plannedTime` is more than 10% above the average actual moving time of the last 3 finished Training
 * Weeks in `finishedWeeks` (oldest first), or of as many as there are. Null without any.
 */
export function volumeStep(plannedTime: number, finishedWeeks: VolumeWeek[]): PlanSuggestion | null {
  const weeks = finishedWeeks.slice(-VOLUME_WEEKS);
  if (weeks.length === 0) return null;
  const total = weeks.reduce((sum, w) => sum + w.total.movingTime, 0);
  // Compared in whole numbers, so exactly 110% is never above it.
  if (plannedTime * weeks.length * 100 <= total * VOLUME_STEP_PERCENT) return null;
  const planned = `${formatHoursMinutes(plannedTime)} planned`;
  const span = weeks.length === 1 ? "the last week" : `the last ${weeks.length} weeks`;
  const average = total / weeks.length;
  const message =
    total === 0
      ? `${planned} after ${weeks.length === 1 ? "a week" : `${weeks.length} weeks`} with no running.`
      : `${planned} is ${Math.round((plannedTime / average - 1) * 100)}% above the ${formatHoursMinutes(average)} you averaged over ${span}.`;
  return { id: "volume-step", kind: "Volume step", date: null, message, proposal: null, runs: [] };
}

/** How many percentage points Planned Quality Share may be from the target before it is mentioned. */
const QUALITY_SHARE_TOLERANCE = 3;

/** Quality Share: Planned Quality Share is more than 3 points from the target, either way. Null with no planned running. */
export function qualityShare(plannedShare: number | null, target: number): PlanSuggestion | null {
  if (plannedShare === null || Math.abs(plannedShare - target) <= QUALITY_SHARE_TOLERANCE) return null;
  const way = plannedShare > target ? "heavy" : "light";
  return {
    id: "quality-share",
    kind: "Quality Share",
    date: null,
    message: `Planned Quality Share is ${plannedShare}%, ${way} on quality against your ${target}% target.`,
    proposal: null,
    runs: [],
  };
}

/** How far LT2 Pace and the intervals.icu Threshold Pace may differ, in seconds per km, before it is mentioned. */
const THRESHOLD_PACE_TOLERANCE = 5;
/** Allows for floating-point error in a difference of exactly the tolerance. */
const EPSILON = 1e-9;

/**
 * Threshold check: LT2 Pace and the intervals.icu Threshold Pace, both metres per second, differ by more than 5 s/km.
 * Null when either is missing.
 */
export function thresholdPaceCheck(lt2Pace: number | null, icuThresholdPace: number | null): PlanSuggestion | null {
  if (lt2Pace === null || icuThresholdPace === null) return null;
  const difference = 1000 / icuThresholdPace - 1000 / lt2Pace;
  if (Math.abs(difference) <= THRESHOLD_PACE_TOLERANCE + EPSILON) return null;
  const pace = (v: number) => `${formatDuration(secondsPerMile(v))} /mi`;
  return {
    id: "threshold-pace",
    kind: "Threshold check",
    date: null,
    message: `LT2 Pace ${pace(lt2Pace)} is ${Math.round(Math.abs(difference))} s/km ${difference > 0 ? "faster" : "slower"} than your intervals.icu Threshold Pace ${pace(icuThresholdPace)}; update it in intervals.icu.`,
    proposal: null,
    runs: [],
  };
}

/**
 * Threshold check: the LTHR new Quality Runs are planned with differs from the one the previous Training Week's
 * Planned Workouts were planned with. Null without LTHR or a previous Quality Run naming a target.
 */
export function lthrChange(lthr: number | null, previousWeek: PlannedWorkout[]): PlanSuggestion | null {
  const last = previousWeek
    .filter((p) => qualityRunFormat(p.name) && heartRateTarget(p.name))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (lthr === null || !last) return null;
  // The previous LTHR is only known from the bpm target it gave, so they are compared in whole bpm.
  const was = Math.round(plannedLthr([last], last.date)!);
  if (Math.round(lthr) === was) return null;
  return {
    id: "lthr-change",
    kind: "Threshold check",
    date: null,
    message: `Targets now use LTHR ${Math.round(lthr)} (was ${was}).`,
    proposal: null,
    runs: [],
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekday(date: string): string {
  return WEEKDAYS[dayOfWeek(date)]!;
}

/** Items written as a list, e.g. "Monday, Tuesday and Sunday". */
function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
