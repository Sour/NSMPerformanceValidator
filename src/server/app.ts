import { Hono } from "hono";
import type { EasyTrend } from "../domain/easyTrend";
import {
  DEFAULT_FITNESS_RANGE,
  FITNESS_RANGES,
  formZoneCount,
  isFitnessRange,
  type FitnessDay,
  type FitnessRange,
  type FormZoneCount,
} from "../domain/fitness";
import { repLengthCards, type RepLengthCard, type RepLengthRun } from "../domain/repProgress";
import { thresholdPaces, type ThresholdPaces } from "../domain/thresholdPace";
import { isLocalDate } from "../domain/localDate";
import { plannableWeeks } from "../domain/weekPlan";
import {
  trainingWeek,
  trainingWeekRange,
  weekStart,
  type TrainingDay,
  type TrainingWeek,
  type TrainingWeekRange,
  type WeekWorkout,
} from "../domain/trainingWeek";
import { weeklyVolume, type VolumeWeek } from "../domain/weeklyVolume";
import type { Db } from "./db";
import { analysedActivities, analysedPlannedWorkouts, easyRuns, fitness, qualityRuns } from "./analysis";
import {
  loadAthleteSettings,
  loadGarminSyncStatus,
  loadPlannedWorkouts,
  loadSyncStatus,
  type GarminSyncStatus,
  type StoredActivity,
  type StoredWeekPlan,
} from "./store";
import type { RefetchOutcome } from "./sync";
import type { SyncRunner } from "./syncRunner";
import {
  acceptSuggestion,
  discardDraft,
  dismissSuggestion,
  isPlannable,
  openWeekPlan,
  plannerSettings,
  planResponse,
  pushWeekPlan,
  saveDraft,
  savePlannerSettingsFrom,
  type PlannerSettingsResponse,
  type PlanResponse,
  type PushResponse,
} from "./plan";
import { noDestination, type PlanDestination } from "./planDestination";

export type { PlannerSettingsResponse, PlanResponse, PushResponse } from "./plan";

export type WeekActivity = Omit<StoredActivity, "raw" | "intervals" | "streams">;
/** A Matched Quality Run is Complete or Incomplete; null for other Planned Workouts. */
export type WeekWorkoutResponse = WeekWorkout<WeekActivity> & { completion: "Complete" | "Incomplete" | null };
/** The Training Week asked for, and through `earliest` and `latest` how far back and forward weeks may be asked for. */
export type WeekResponse = Omit<TrainingWeek<WeekActivity>, "days"> &
  TrainingWeekRange & {
  today: string;
  days: (Omit<TrainingDay<WeekActivity>, "workouts"> & { workouts: WeekWorkoutResponse[] })[];
};
export interface ProgressResponse {
  cards: RepLengthCard[];
}
/** A re-fetched Activity is either still Matched to a Quality Run, given as that run now is, or no longer. */
export type RefetchResponse = { outcome: "Updated"; run: RepLengthRun } | { outcome: Exclude<RefetchOutcome, "Updated"> };
export interface VolumeResponse {
  /** Oldest first; the last is this Training Week. */
  weeks: VolumeWeek[];
  /** The runner's Quality Share Target, a whole percentage, to draw beside each week's Quality Share. */
  qualityShareTarget: number;
}
export type EasyResponse = EasyTrend;
export interface ThresholdsResponse extends ThresholdPaces {
  /** The intervals.icu Threshold Pace in metres per second, a reference beside LT2 Pace; null when none is synced. */
  icuThresholdPace: number | null;
}
export interface FitnessResponse {
  range: FitnessRange;
  /** One per day of the range through today, oldest first; none before stored history starts, and none without LTHR. */
  days: FitnessDay[];
  /** The returned days in each Form Zone; settling days and a day still counting a plan are left out. */
  formZones: FormZoneCount;
}

/** What the runner has set for the app. */
export interface Settings {
  /** The runner's own LT1 HR in bpm; null to assume it from LTHR. */
  lt1Hr: number | null;
}
export interface SyncStatusResponse {
  /** When the latest sync finished, as an ISO timestamp. */
  lastFinishedAt: string | null;
  /** When the latest successful sync finished, as an ISO timestamp. */
  lastSucceededAt: string | null;
  /** Why the latest sync failed; null when it succeeded. */
  lastError: string | null;
  /** Whether a sync is running now. */
  running: boolean;
  /** How syncing the running LTHR and Max HR from Garmin is going. */
  garmin: GarminSyncStatus;
}

/** Why `week` cannot be planned on `today`: it is not a Monday, or not the current or next Training Week's. */
function unplannable(week: string, today: string): { status: 400 | 404; error: string } | null {
  if (!isLocalDate(week) || weekStart(week) !== week) return { status: 400, error: "week must be a Monday, YYYY-MM-DD" };
  if (!isPlannable(week, today)) return { status: 404, error: "Only the current and next Training Week can be planned" };
  return null;
}

/** Reloads one Activity from intervals.icu; see `refetchActivity`. */
export type Refetch = (activityId: string) => Promise<RefetchOutcome>;

export function createApp(
  db: Db,
  today: () => string,
  syncRunner: SyncRunner,
  settings: Settings = { lt1Hr: null },
  refetch: Refetch = async () => {
    throw new Error("Re-fetch is not available");
  },
  destination: PlanDestination = noDestination,
) {
  const syncStatus = (): SyncStatusResponse => {
    const status = loadSyncStatus(db);
    return {
      lastFinishedAt: status?.finishedAt ?? null,
      lastSucceededAt: status?.succeededAt ?? null,
      lastError: status?.error ?? null,
      running: syncRunner.running,
      garmin: loadGarminSyncStatus(db),
    };
  };

  /** The Week Plan of `week` as of today, opened (and started if new), or why that week cannot be planned. */
  const openPlan = (week: string): { plan: StoredWeekPlan; date: string } | { status: 400 | 404; error: string } => {
    const date = today();
    return unplannable(week, date) ?? { plan: openWeekPlan(db, week, date), date };
  };

  return new Hono()
    .get("/api/week", (c) => {
      const date = today();
      const viewed = c.req.query("date") ?? date;
      if (!isLocalDate(viewed)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
      const analysedPlanned = analysedPlannedWorkouts(db);
      const planned = analysedPlanned.map(({ recovery: _, ...p }) => p);
      const analysed = analysedActivities(db);
      const activities = analysed.map(({ intervals: _, intervalsChangedAt: __, ...a }) => a);
      const week = trainingWeek(date, planned, activities, viewed);
      const runs = qualityRuns(analysedPlanned, analysed);
      const completion = (w: WeekWorkout<WeekActivity>): WeekWorkoutResponse["completion"] => {
        const run = runs.find((r) => r.activityId === w.activity?.id);
        if (!run) return null;
        return run.complete ? "Complete" : "Incomplete";
      };
      return c.json<WeekResponse>({
        today: date,
        ...week,
        ...trainingWeekRange(date, planned),
        days: week.days.map((d) => ({ ...d, workouts: d.workouts.map((w) => ({ ...w, completion: completion(w) })) })),
      });
    })
    .get("/api/progress", (c) => {
      return c.json<ProgressResponse>({ cards: repLengthCards(analysedPlannedWorkouts(db), analysedActivities(db)) });
    })
    .get("/api/volume", (c) => {
      const planned = loadPlannedWorkouts(db).map(({ raw: _, ...p }) => p);
      return c.json<VolumeResponse>({
        weeks: weeklyVolume(today(), planned, analysedActivities(db)),
        qualityShareTarget: plannerSettings(db, today()).qualityShareTarget,
      });
    })
    .get("/api/easy", (c) => c.json<EasyResponse>(easyRuns(db, today())))
    .get("/api/fitness", (c) => {
      const range = c.req.query("range") ?? DEFAULT_FITNESS_RANGE;
      if (!isFitnessRange(range)) return c.json({ error: `range must be one of ${Object.keys(FITNESS_RANGES).join(", ")}` }, 400);
      const days = fitness(db, today(), FITNESS_RANGES[range]);
      return c.json<FitnessResponse>({ range, days, formZones: formZoneCount(days) });
    })
    .get("/api/thresholds", (c) => {
      const analysedPlanned = analysedPlannedWorkouts(db);
      const runs = qualityRuns(analysedPlanned, analysedActivities(db));
      return c.json<ThresholdsResponse>({
        ...thresholdPaces(analysedPlanned, runs, easyRuns(db, today()).runs, today(), settings.lt1Hr),
        icuThresholdPace: loadAthleteSettings(db).runThresholdPace,
      });
    })
    .post("/api/activities/:id/refetch", async (c) => {
      let outcome: RefetchOutcome;
      try {
        outcome = await refetch(c.req.param("id"));
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
      if (outcome !== "Updated") return c.json<RefetchResponse>({ outcome });
      const run = qualityRuns(analysedPlannedWorkouts(db), analysedActivities(db)).find((r) => r.activityId === c.req.param("id"));
      return c.json<RefetchResponse>(run ? { outcome, run } : { outcome: "NotQualityRun" });
    })
    .get("/api/plan", (c) => {
      const opened = openPlan(c.req.query("week") ?? plannableWeeks(today()).next);
      if ("error" in opened) return c.json({ error: opened.error }, opened.status);
      return c.json<PlanResponse>(planResponse(db, opened.plan, opened.date));
    })
    .put("/api/plan/:week", async (c) => {
      const opened = openPlan(c.req.param("week"));
      if ("error" in opened) return c.json({ error: opened.error }, opened.status);
      const saved = saveDraft(db, opened.plan, await c.req.json().catch(() => null), opened.date);
      if ("error" in saved) return c.json({ error: saved.error }, saved.status);
      return c.json<PlanResponse>(planResponse(db, saved, opened.date));
    })
    .post("/api/plan/:week/discard", (c) => {
      const opened = openPlan(c.req.param("week"));
      if ("error" in opened) return c.json({ error: opened.error }, opened.status);
      return c.json<PlanResponse>(planResponse(db, discardDraft(db, opened.plan, opened.date), opened.date));
    })
    .post("/api/plan/:week/suggestions/:id/:action{accept|dismiss}", (c) => {
      const opened = openPlan(c.req.param("week"));
      if ("error" in opened) return c.json({ error: opened.error }, opened.status);
      const act = c.req.param("action") === "accept" ? acceptSuggestion : dismissSuggestion;
      const result = act(db, opened.plan, opened.date, c.req.param("id"));
      if (result === null) return c.json({ error: "No such Plan Suggestion is showing for this week" }, 404);
      if ("error" in result) return c.json({ error: result.error }, result.status);
      return c.json<PlanResponse>(planResponse(db, result, opened.date));
    })
    .post("/api/plan/:week/push", async (c) => {
      const opened = openPlan(c.req.param("week"));
      if ("error" in opened) return c.json({ error: opened.error }, opened.status);
      const body = ((await c.req.json().catch(() => null)) ?? {}) as { replaceNsmApp?: unknown; overwrite?: unknown };
      const pushed = await pushWeekPlan(db, opened.plan, opened.date, destination, {
        replaceNsmApp: body.replaceNsmApp === true,
        overwrite: body.overwrite === true,
      });
      if ("status" in pushed) return c.json({ error: pushed.error }, pushed.status);
      return c.json<PushResponse>(pushed, pushed.outcome === "Failed" ? 502 : 200);
    })
    .get("/api/planner-settings", (c) => c.json<PlannerSettingsResponse>(plannerSettings(db, today())))
    .put("/api/planner-settings", async (c) => {
      const saved = savePlannerSettingsFrom(db, await c.req.json().catch(() => null));
      if (!saved) return c.json({ error: "Easy HR Target and Quality Share Target must be whole percentages, low below high" }, 400);
      return c.json<PlannerSettingsResponse>(plannerSettings(db, today()));
    })
    .get("/api/sync", (c) => c.json(syncStatus()))
    .post("/api/sync", async (c) => {
      await syncRunner.run();
      return c.json(syncStatus());
    });
}
