import { currentEasyHrTarget, type EasyHrTarget } from "../domain/easyTrend";
import { addDays } from "../domain/localDate";
import {
  easyDiscipline,
  lthrChange,
  pullBack,
  qualityShare,
  thresholdPaceCheck,
  volumeStep,
  type PlanSuggestion,
} from "../domain/planSuggestions";
import { thresholdPaces } from "../domain/thresholdPace";
import { trainingWeek } from "../domain/trainingWeek";
import { weeklyVolume } from "../domain/weeklyVolume";
import {
  dayEditable,
  plannableWeeks,
  plannedQualityShare,
  plannedRepTime,
  sameDay,
  startWeekPlan,
  weekDates,
  weekPlannedTime,
  weekPlanStatus,
  type CalendarWorkout,
  type WeekPlanDay,
  type WeekPlanStatus,
} from "../domain/weekPlan";
import { analysedActivities, analysedPlannedWorkouts, easyPlannedWorkouts, easyRuns, qualityRuns } from "./analysis";
import type { NsmAppWorkout, PlanDestination } from "./planDestination";
import type { Db } from "./db";
import { isNsmEvent, isOwnedEvent, weekPlanDay, type IntervalsEvent } from "./intervals";
import {
  loadAthleteSettings,
  loadDismissals,
  loadPlannedWorkouts,
  loadPlannerSettings,
  loadWeekPlan,
  saveDismissal,
  savePlannerSettings,
  saveWeekPlan,
  type StoredPlannerSettings,
  type StoredWeekPlan,
} from "./store";

export interface PlanDayResponse {
  date: string;
  day: WeekPlanDay;
  /** The day has not passed, and nothing is Matched to it today. */
  editable: boolean;
}

export interface PlanSummary {
  /** Seconds. */
  plannedTime: number;
  /** The Reps' planned time, in seconds. */
  repTime: number;
  /** Null for a week with no planned running. */
  plannedQualityShare: number | null;
  qualityShareTarget: number;
}

/** The values the planner uses for targets and checks. */
export interface PlannerSettingsResponse {
  /** The Easy HR Target new Planned Workouts are given; by default the current one. Null with neither set nor planned. */
  easyHrTarget: EasyHrTarget | null;
  /** A whole percentage; 25 by default. */
  qualityShareTarget: number;
  /** From the athlete's intervals.icu Run settings, as the latest sync read them; each null when none is set. */
  lthr: number | null;
  maxHr: number | null;
}

/** One Week Plan with its status and summary, and which Training Weeks can be planned. */
export interface PlanResponse {
  /** The Training Week's Monday. */
  week: string;
  today: string;
  /** The Mondays of the only Training Weeks that can be planned. */
  current: string;
  next: string;
  status: WeekPlanStatus;
  /** When the latest push finished, as an ISO timestamp; null before the first. */
  pushedAt: string | null;
  days: PlanDayResponse[];
  summary: PlanSummary;
  /** Those not dismissed for this week. */
  suggestions: PlanSuggestion[];
  settings: PlannerSettingsResponse;
}

const DEFAULT_QUALITY_SHARE_TARGET = 25;

export function plannerSettings(db: Db, today: string): PlannerSettingsResponse {
  const stored = loadPlannerSettings(db);
  const { lthr, maxHr } = loadAthleteSettings(db);
  return {
    easyHrTarget: stored.easyHrTarget ?? currentEasyHrTarget(easyPlannedWorkouts(db), today),
    qualityShareTarget: stored.qualityShareTarget ?? DEFAULT_QUALITY_SHARE_TARGET,
    lthr,
    maxHr,
  };
}

/**
 * Saves the runner's planner settings from a request body; false when they are not whole percentages, low below high.
 * An `easyHrTarget` left out keeps the one set; null goes back to following the current Easy HR Target.
 */
export function savePlannerSettingsFrom(db: Db, input: unknown): boolean {
  const body = (input ?? {}) as { easyHrTarget?: { low?: unknown; high?: unknown } | null; qualityShareTarget?: unknown };
  const percent = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
  if (!percent(body.qualityShareTarget)) return false;
  let easyHrTarget = loadPlannerSettings(db).easyHrTarget;
  if (body.easyHrTarget !== undefined) {
    const { low, high } = body.easyHrTarget ?? {};
    if (body.easyHrTarget !== null && (!percent(low) || !percent(high) || (low as number) >= (high as number))) return false;
    easyHrTarget = body.easyHrTarget === null ? null : { low: low as number, high: high as number };
  }
  const settings: StoredPlannerSettings = { easyHrTarget, qualityShareTarget: body.qualityShareTarget as number };
  savePlannerSettings(db, settings);
  return true;
}

/** The [NSM] Planned Workouts stored for the Training Week starting `week`, as Week Plan days. */
function calendarWorkouts(db: Db, week: string): CalendarWorkout[] {
  const dates = weekDates(week);
  return loadPlannedWorkouts(db).flatMap((p) => {
    const event = p.raw as IntervalsEvent;
    const day = dates.includes(p.date) && isNsmEvent(event) ? weekPlanDay(event) : null;
    return day ? [{ date: p.date, day, nsmApp: !isOwnedEvent(event) }] : [];
  });
}

/** Whether each day can still be edited on `today`: not passed, and today only while nothing is Matched to it. */
export function editableDays(db: Db, today: string): (date: string) => boolean {
  const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
  const day = trainingWeek(today, planned, analysedActivities(db)).days.find((d) => d.date === today);
  const todayMatched = day?.workouts.some((w) => w.status === "Matched") ?? false;
  return (date) => dayEditable(date, today, todayMatched);
}

/** The stored Week Plan for the Training Week starting `week`, started and stored the first time it is opened. */
export function openWeekPlan(db: Db, week: string, today: string): StoredWeekPlan {
  const stored = loadWeekPlan(db, week);
  if (stored) return stored;
  const plan: StoredWeekPlan = { week, days: freshDays(db, week, today), pushed: {}, pushedAt: null, changedOnIntervals: false };
  saveWeekPlan(db, plan);
  return plan;
}

/** The days a Week Plan for `week` would start with now. */
export function freshDays(db: Db, week: string, today: string): WeekPlanDay[] {
  const previousWeek = addDays(week, -7);
  return startWeekPlan({
    week,
    previousPlan: loadWeekPlan(db, previousWeek)?.days ?? null,
    previousWeekWorkouts: calendarWorkouts(db, previousWeek),
    thisWeekWorkouts: calendarWorkouts(db, week),
    editable: editableDays(db, today),
  });
}

/** Whether `week` is the Monday of a Training Week that can be planned on `today`. */
export function isPlannable(week: string, today: string): boolean {
  const { current, next } = plannableWeeks(today);
  return week === current || week === next;
}

export function planResponse(db: Db, plan: StoredWeekPlan, today: string): PlanResponse {
  const editable = editableDays(db, today);
  const settings = plannerSettings(db, today);
  return {
    week: plan.week,
    today,
    ...plannableWeeks(today),
    status: weekPlanStatus(plan.week, plan.days, plan.pushed, plan.changedOnIntervals, editable),
    pushedAt: plan.pushedAt,
    days: weekDates(plan.week).map((date, i) => ({ date, day: plan.days[i]!, editable: editable(date) })),
    summary: {
      plannedTime: weekPlannedTime(plan.days),
      repTime: plannedRepTime(plan.days),
      plannedQualityShare: plannedQualityShare(plan.days),
      qualityShareTarget: settings.qualityShareTarget,
    },
    suggestions: planSuggestions(db, plan, today, settings, editable),
    settings,
  };
}

/** The Plan Suggestions for `plan` from recent progress, without those dismissed for its week. */
function planSuggestions(
  db: Db,
  plan: StoredWeekPlan,
  today: string,
  settings: PlannerSettingsResponse,
  editable: (date: string) => boolean,
): PlanSuggestion[] {
  const dismissed = new Set(loadDismissals(db, plan.week));
  const analysedPlanned = analysedPlannedWorkouts(db);
  const activities = analysedActivities(db);
  const runs = qualityRuns(analysedPlanned, activities);
  const easy = easyRuns(db, today).runs;
  const thisWeek = plannableWeeks(today).current;
  const planned = analysedPlanned.map(({ recovery: _, ...p }) => p);
  const finishedWeeks = weeklyVolume(today, planned, activities).filter((w) => w.start < thisWeek);
  const { lt2Pace } = thresholdPaces(planned, runs, easy, today, null);
  const previousWeek = planned.filter((p) => p.date >= addDays(plan.week, -7) && p.date < plan.week);
  const all = [
    ...weekDates(plan.week).map((date, i) => (editable(date) ? pullBack({ date, day: plan.days[i]! }, runs, plan.week) : null)),
    easyDiscipline(easy, addDays(thisWeek, -7), settings.easyHrTarget),
    volumeStep(weekPlannedTime(plan.days), finishedWeeks),
    qualityShare(plannedQualityShare(plan.days), settings.qualityShareTarget),
    thresholdPaceCheck(lt2Pace, loadAthleteSettings(db).runThresholdPace),
    lthrChange(settings.lthr, previousWeek),
  ];
  return all.filter((s): s is PlanSuggestion => s !== null && !dismissed.has(s.id));
}

/** Hides the suggestion `id` for the week of `plan`; null when it is not showing. */
export function dismissSuggestion(db: Db, plan: StoredWeekPlan, today: string, id: string): StoredWeekPlan | null {
  if (!planResponse(db, plan, today).suggestions.some((s) => s.id === id)) return null;
  saveDismissal(db, plan.week, id);
  return plan;
}

/**
 * Makes the change the suggestion `id` proposes to the draft of `plan`, and hides it for the week. Null when it is not
 * showing; a rejection when it proposes no change, or one to a day that can no longer be edited.
 */
export function acceptSuggestion(db: Db, plan: StoredWeekPlan, today: string, id: string): StoredWeekPlan | Rejection | null {
  const suggestion = planResponse(db, plan, today).suggestions.find((s) => s.id === id);
  if (!suggestion) return null;
  if (!suggestion.proposal) return { status: 409, error: "This suggestion proposes no change" };
  const { date, day } = suggestion.proposal;
  const days = weekDates(plan.week).map((d, i) => (d === date ? day : plan.days[i]!));
  const saved = saveDraft(db, plan, { days }, today);
  if ("error" in saved) return saved;
  saveDismissal(db, plan.week, id);
  return saved;
}

/** Why a request was refused, as an HTTP status and message. */
export type Rejection = { status: 400 | 409; error: string };

/** Saves `input` as the draft of `plan`, or says why it cannot be. */
export function saveDraft(db: Db, plan: StoredWeekPlan, input: unknown, today: string): StoredWeekPlan | Rejection {
  const days = parseDays(input);
  if (days === null) return { status: 400, error: "days must be seven Week Plan days, Monday first" };
  const editable = editableDays(db, today);
  const frozen = weekDates(plan.week).find((date, i) => !editable(date) && !sameDay(plan.days[i], days[i]));
  if (frozen !== undefined) return { status: 409, error: `${frozen} can no longer be edited` };
  const saved = { ...plan, days };
  saveWeekPlan(db, saved);
  return saved;
}

/**
 * Resets the draft of `plan` to what was last pushed, and days never pushed to a fresh start. Days that can no longer
 * be edited stay as they are.
 */
export function discardDraft(db: Db, plan: StoredWeekPlan, today: string): StoredWeekPlan {
  const editable = editableDays(db, today);
  const fresh = freshDays(db, plan.week, today);
  const days = weekDates(plan.week).map((date, i) =>
    editable(date) ? (plan.pushed[date]?.day ?? fresh[i]!) : plan.days[i]!,
  );
  const discarded = { ...plan, days };
  saveWeekPlan(db, discarded);
  return discarded;
}

/** Seven Week Plan days read from a request body's `days`; null when it is not that. */
function parseDays(input: unknown): WeekPlanDay[] | null {
  const days = (input as { days?: unknown } | null)?.days;
  if (!Array.isArray(days) || days.length !== 7) return null;
  const parsed = days.map(parseDay);
  return parsed.every((d) => d !== null) ? (parsed as WeekPlanDay[]) : null;
}

function parseDay(input: unknown): WeekPlanDay | null {
  const d = (input ?? {}) as Record<string, unknown>;
  const seconds = (v: unknown, min: number) => (Number.isInteger(v) && (v as number) >= min ? (v as number) : null);
  switch (d.kind) {
    case "Quality Run": {
      const fields = {
        reps: seconds(d.reps, 1),
        repLength: seconds(d.repLength, 1),
        recovery: seconds(d.recovery, 0),
        warmUp: seconds(d.warmUp, 0),
        coolDown: seconds(d.coolDown, 0),
      };
      if (Object.values(fields).some((v) => v === null)) return null;
      return { kind: d.kind, ...(fields as { [K in keyof typeof fields]: number }) };
    }
    case "Easy Run":
    case "Long Run": {
      const duration = seconds(d.duration, 1);
      return duration === null ? null : { kind: d.kind, duration };
    }
    case "Rest":
      return { kind: d.kind };
    default:
      return null;
  }
}

export type PushResponse =
  | { outcome: "Pushed"; plan: PlanResponse }
  /** The push stopped at the destination's `error`; the days pushed before it are recorded. */
  | { outcome: "Failed"; error: string; plan: PlanResponse }
  /** NSM-app workouts are on the remaining days; push again with `replaceNsmApp` to delete them. Nothing changed. */
  | { outcome: "ConfirmReplace"; nsmAppWorkouts: NsmAppWorkout[] }
  /** A pushed workout was changed on intervals.icu; push again with `overwrite` to restore the Week Plan's. */
  | { outcome: "ConfirmOverwrite" };

export interface PushOptions {
  replaceNsmApp: boolean;
  overwrite: boolean;
}

/**
 * Pushes the days of `plan` that can still be edited to `destination`, and records what it made of each.
 * Rejects, without asking the destination, when there is no Easy HR Target, and asks first before overwriting a
 * change made on intervals.icu.
 */
export async function pushWeekPlan(
  db: Db,
  plan: StoredWeekPlan,
  today: string,
  destination: PlanDestination,
  { replaceNsmApp, overwrite }: PushOptions,
): Promise<PushResponse | Rejection> {
  if (plan.changedOnIntervals && !overwrite) return { outcome: "ConfirmOverwrite" };
  const settings = plannerSettings(db, today);
  if (settings.easyHrTarget === null) return { status: 409, error: "Set an Easy HR Target before pushing" };
  const editable = editableDays(db, today);
  const days = weekDates(plan.week).flatMap((date, i) => (editable(date) ? [{ date, day: plan.days[i]! }] : []));

  const result = await destination.push({ days, targets: { lthr: settings.lthr, easyHrTarget: settings.easyHrTarget }, replaceNsmApp });
  if (result.outcome === "ConfirmReplace") return result;

  const pushed = { ...plan.pushed };
  for (const { date, eventId, version } of result.days) {
    pushed[date] = { day: days.find((d) => d.date === date)!.day, eventId, version };
  }
  const saved: StoredWeekPlan = {
    ...plan,
    pushed,
    pushedAt: result.days.length > 0 ? new Date().toISOString() : plan.pushedAt,
    changedOnIntervals: result.outcome === "Pushed" ? false : plan.changedOnIntervals,
  };
  saveWeekPlan(db, saved);
  const response = planResponse(db, saved, today);
  return result.outcome === "Pushed" ? { outcome: "Pushed", plan: response } : { outcome: "Failed", error: result.error, plan: response };
}
