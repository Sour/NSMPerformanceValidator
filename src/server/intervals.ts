import type { ActivityStreams } from "../domain/activityStreams";
import type { EasyAverages, EasyHrTarget } from "../domain/easyTrend";
import type { FitnessStart } from "../domain/fitness";
import { localDate } from "../domain/localDate";
import type { Activity, PlannedWorkout } from "../domain/matching";
import { qualityRunFormat, type DetectedInterval } from "../domain/qualityRun";
import { runType } from "../domain/runType";
import type { LoadedWorkout, PlannedHrTarget, PlannedStep } from "../domain/trainingLoad";
import type { WorkoutDay } from "../domain/weekPlan";

/** The fields we read from an intervals.icu calendar event; the full response is kept as raw. */
export interface IntervalsEvent {
  id: number;
  start_date_local: string;
  category: string;
  type: string | null;
  name: string;
  description: string | null;
  paired_activity_id: string | null;
  [field: string]: unknown;
}

/** The fields we read from an intervals.icu activity; the full response is kept as raw. */
export interface IntervalsActivity {
  id: string;
  start_date_local: string;
  type: string;
  name: string;
  moving_time: number;
  distance: number | null;
  paired_event_id: number | null;
  [field: string]: unknown;
}

/** Marks a Planned Workout as part of the NSM plan, in its intervals.icu description. */
export const NSM_TAG = "[NSM]";

/**
 * Marks the Planned Workouts this app pushed, as the start of their `external_id`. The NSM app's own are
 * `nsm-<date>`; this one cannot be mistaken for those.
 */
const OWNED_EXTERNAL_ID = "nsmpv-";

/** A Planned Workout tagged [NSM]: made by the NSM app, or by this app in its conventions. */
export function isNsmEvent(e: Pick<IntervalsEvent, "description">): boolean {
  return e.description?.includes(NSM_TAG) ?? false;
}

/** A Planned Workout this app pushed, which only this app changes. */
export function isOwnedEvent(e: { [field: string]: unknown }): boolean {
  return typeof e.external_id === "string" && e.external_id.startsWith(OWNED_EXTERNAL_ID);
}

/** The ownership marker of the workout this app pushes for `date`. */
export function ownedExternalId(date: string): string {
  return `${OWNED_EXTERNAL_ID}${date}`;
}

/**
 * A Planned Workout's version as far as a push is concerned: its date, name and steps. It changes when the workout is
 * edited on intervals.icu, and not when intervals.icu only pairs an Activity with it.
 */
export function eventVersion(e: IntervalsEvent): string {
  return JSON.stringify([localDate(e.start_date_local), e.name, e.description]);
}

export function toPlannedWorkout(e: IntervalsEvent): PlannedWorkout {
  return { id: e.id, date: localDate(e.start_date_local), name: e.name, pairedActivityId: e.paired_activity_id ?? null };
}

export function toActivity(a: IntervalsActivity): Activity {
  return {
    id: a.id,
    date: localDate(a.start_date_local),
    type: a.type,
    name: a.name,
    movingTime: a.moving_time ?? 0,
    pairedEventId: a.paired_event_id ?? null,
  };
}

/**
 * An Activity's whole-run Easy GAP and Easy HR, read from its intervals.icu activity response; each null when not recorded.
 * A GAP of zero, as from a treadmill run without a foot pod, is not recorded either: it has no pace.
 */
export function activityAverages(activity: unknown): EasyAverages {
  const a = (activity ?? {}) as { gap?: unknown; average_heartrate?: unknown };
  return {
    easyGap: typeof a.gap === "number" && a.gap > 0 ? a.gap : null,
    easyHr: typeof a.average_heartrate === "number" ? a.average_heartrate : null,
  };
}

/**
 * What intervals.icu recorded with an Activity or Cross-Training workout to score its Training Load against, read from
 * its activity response: the LTHR, Max HR, resting HR and Threshold Pace of that sport's settings at the time, and its
 * moving time and average GAP. Each null when not recorded; a GAP of zero, as from a treadmill run, is not recorded.
 */
export function recordedLoadInputs(activity: unknown): Omit<LoadedWorkout, "running" | "streams"> {
  const a = (activity ?? {}) as Record<string, unknown>;
  return {
    movingTime: positive(a.moving_time) ?? 0,
    gap: positive(a.gap),
    thresholds: {
      lthr: positive(a.lthr),
      maxHr: positive(a.athlete_max_hr),
      restingHr: positive(a.icu_resting_hr),
      thresholdPace: positive(a.threshold_pace),
    },
  };
}

interface WorkoutStep {
  reps?: number;
  hr?: { start?: unknown; end?: unknown; units?: unknown };
  intensity?: string;
  duration?: number;
  warmup?: boolean;
  cooldown?: boolean;
  steps?: WorkoutStep[];
}

/**
 * A Planned Workout as a Week Plan day, read from its name and `workout_doc`: a Quality Run's Format from the name, its
 * recovery, warm-up and cool-down from the structure (0 when it has none) and its Rep Pace Target from the workout text,
 * or an Easy Run's or Long Run's duration.
 * Null for a Planned Workout of no Run Type.
 */
export function weekPlanDay(event: IntervalsEvent): WorkoutDay | null {
  const doc = (event as { workout_doc?: { steps?: WorkoutStep[]; duration?: unknown } | null }).workout_doc;
  const type = runType(event.name);
  if (type === "Quality Run") {
    const steps = doc?.steps ?? [];
    const stepDuration = (s: WorkoutStep | undefined) => (typeof s?.duration === "number" ? s.duration : 0);
    const repPaceTarget = plannedRepPaceTarget(event);
    return {
      kind: type,
      ...qualityRunFormat(event.name)!,
      recovery: plannedRecovery(event) ?? 0,
      warmUp: stepDuration(steps.find((s) => s.warmup)),
      coolDown: stepDuration(steps.find((s) => s.cooldown)),
      ...(repPaceTarget !== null && { repPaceTarget }),
    };
  }
  if (type === null) return null;
  const duration = typeof doc?.duration === "number" ? doc.duration : Number(event.moving_time ?? 0);
  return { kind: type, duration };
}

/** A Rep step's pace band in this app's workout text, e.g. "- 10m 6:55/mi-7:05/mi Pace intensity=active". */
const REP_PACE_BAND_TEXT = /^- \S+ (\d+):(\d\d)\/mi-(\d+):(\d\d)\/mi Pace intensity=active$/m;

/**
 * A Quality Run's Rep Pace Target in seconds per mile: the middle of the pace band its Reps are given in the workout
 * text this app wrote, which intervals.icu keeps as the event's description. Null when its Reps have none.
 */
export function plannedRepPaceTarget(event: { description?: unknown }): number | null {
  const band = REP_PACE_BAND_TEXT.exec(typeof event.description === "string" ? event.description : "");
  if (!band) return null;
  const low = Number(band[1]) * 60 + Number(band[2]);
  const high = Number(band[3]) * 60 + Number(band[4]);
  return (low + high) / 2;
}

/**
 * The recovery between Reps, in seconds, read from an intervals.icu calendar event's `workout_doc`:
 * the recovery step inside its first repeated block. Null when it has no such step.
 */
export function plannedRecovery(event: unknown): number | null {
  const doc = (event as { workout_doc?: { steps?: WorkoutStep[] } | null } | null)?.workout_doc;
  const steps = doc?.steps ?? [];
  const recovery = steps.find((s) => s.reps !== undefined)?.steps?.find((s) => s.intensity === "recovery");
  return typeof recovery?.duration === "number" ? recovery.duration : null;
}

/**
 * The Easy HR Target read from an intervals.icu calendar event's `workout_doc`: the first step, at any depth, whose
 * heart-rate target is given as `%hr`, a percentage of Max HR. Null when it has no such step.
 */
export function plannedEasyHrTarget(event: unknown): EasyHrTarget | null {
  const doc = (event as { workout_doc?: { steps?: WorkoutStep[] } | null } | null)?.workout_doc;
  const find = (steps: WorkoutStep[]): EasyHrTarget | null => {
    for (const s of steps) {
      const hr = s.hr;
      if (hr?.units === "%hr" && typeof hr.start === "number" && typeof hr.end === "number") return { low: hr.start, high: hr.end };
      const nested = find(s.steps ?? []);
      if (nested) return nested;
    }
    return null;
  };
  return find(doc?.steps ?? []);
}

const HR_TARGET_UNITS: Record<string, PlannedHrTarget["units"]> = { "%hr": "%hr", "%lthr": "%lthr", bpm: "bpm" };

/** A Rep's heart-rate target, 90–98% of LTHR, which a Rep guided by a Rep Pace Target still has. */
const REP_HR_TARGET: PlannedHrTarget = { low: 90, high: 98, units: "%lthr" };

/**
 * A Planned Workout's steps with their heart-rate targets, read from an intervals.icu calendar event's `workout_doc`:
 * a step with `reps` is a repeat group. A step's target is null when it has none in heart rate, as a recovery, and its
 * duration null when not given in seconds. The Reps of a Quality Run with a Rep Pace Target, given in pace, have their
 * heart-rate target all the same. Empty without a `workout_doc`.
 */
export function plannedSteps(event: unknown): PlannedStep[] {
  const e = (event ?? {}) as { workout_doc?: { steps?: WorkoutStep[] } | null; name?: unknown; description?: unknown };
  const paced = typeof e.name === "string" && runType(e.name) === "Quality Run" && plannedRepPaceTarget(e) !== null;
  const read = (steps: WorkoutStep[], inRepeat: boolean): PlannedStep[] =>
    steps.map((s) => {
      if (typeof s.reps === "number") return { kind: "repeat", reps: s.reps, steps: read(s.steps ?? [], true) };
      const { start, end, units } = s.hr ?? {};
      const known = typeof units === "string" ? HR_TARGET_UNITS[units] : undefined;
      const target = known && typeof start === "number" && typeof end === "number" ? { low: start, high: end, units: known } : null;
      const pacedRep = paced && inRepeat && s.intensity === "active" && target === null;
      return { kind: "step", duration: typeof s.duration === "number" ? s.duration : null, target: pacedRep ? REP_HR_TARGET : target };
    });
  return read(e.workout_doc?.steps ?? [], false);
}

/** The intervals intervals.icu detected in an Activity, read from its `GET /activity/{id}/intervals` response. */
export function detectedIntervals(response: unknown): DetectedInterval[] {
  const intervals = (response as { icu_intervals?: Record<string, unknown>[] } | null)?.icu_intervals ?? [];
  return intervals.map((i) => ({
    type: String(i.type),
    movingTime: Number(i.moving_time ?? 0),
    distance: typeof i.distance === "number" ? i.distance : null,
    gap: typeof i.gap === "number" ? i.gap : null,
    averageHeartrate: typeof i.average_heartrate === "number" ? i.average_heartrate : null,
  }));
}

/**
 * When intervals.icu last analysed an Activity's intervals, read from its `GET /activity/{id}/intervals` response:
 * its `analyzed` ISO timestamp, which moves when the intervals are edited. Null when the response has none.
 */
export function intervalsAnalyzedAt(response: unknown): string | null {
  const analyzed = (response as { analyzed?: unknown } | null)?.analyzed;
  return typeof analyzed === "string" ? analyzed : null;
}

/**
 * An Activity's streams, read from its `GET /activity/{id}/streams` response. Null when it has no time stream, as when
 * it was not fetched; a heart-rate, cadence or speed stream not recorded is null on its own.
 */
export function activityStreams(response: unknown): ActivityStreams | null {
  const list = Array.isArray(response) ? (response as { type?: unknown; data?: unknown }[]) : [];
  const stream = (type: string) => {
    const data = list.find((s) => s.type === type)?.data;
    return Array.isArray(data) ? data.map((v) => (typeof v === "number" ? v : null)) : null;
  };
  const time = stream("time");
  if (time === null || time.some((t) => t === null)) return null;
  return { time: time as number[], heartrate: stream("heartrate"), cadence: stream("cadence"), velocity: stream("velocity_smooth") };
}

/** Whether a stored streams response was fetched with a speed stream, which Training Load leaves stopped time out by. */
export function hasSpeedStream(response: unknown): boolean {
  return Array.isArray(response) && response.some((s: { type?: unknown }) => s?.type === "velocity_smooth");
}

/**
 * Fitness and Fatigue at the end of a day, read from intervals.icu's `GET /athlete/{id}/wellness/{date}` response: its
 * `ctl` and `atl`. Null when it has either missing.
 */
export function wellnessFitness(response: unknown): Omit<FitnessStart, "date"> | null {
  const w = (response ?? {}) as { ctl?: unknown; atl?: unknown };
  return typeof w.ctl === "number" && typeof w.atl === "number" ? { fitness: w.ctl, fatigue: w.atl } : null;
}

/**
 * The intervals.icu Threshold Pace of the athlete's Run settings, read from a `GET /athlete/{id}` response:
 * the `threshold_pace` of the sport settings covering Run, always metres per second. Null when there is none.
 */
export function runThresholdPace(athlete: unknown): number | null {
  return positive(runSettings(athlete)?.threshold_pace);
}

/** The Max HR of the athlete's Run settings in bpm, read from a `GET /athlete/{id}` response. Null when there is none. */
export function runMaxHr(athlete: unknown): number | null {
  return positive(runSettings(athlete)?.max_hr);
}

/** The LTHR of the athlete's Run settings in bpm, read from a `GET /athlete/{id}` response. Null when there is none. */
export function runLthr(athlete: unknown): number | null {
  return positive(runSettings(athlete)?.lthr);
}

/** Whether a `GET /athlete/{id}` response has sport settings covering Run. */
export function hasRunSettings(athlete: unknown): boolean {
  return runSettings(athlete) !== undefined;
}

/** The sport settings covering Run in a `GET /athlete/{id}` response. */
function runSettings(athlete: unknown): Record<string, unknown> | undefined {
  const settings = (athlete as { sportSettings?: { types?: unknown }[] } | null)?.sportSettings;
  return (Array.isArray(settings) ? settings : []).find((s) => Array.isArray(s.types) && s.types.includes("Run"));
}

function positive(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

/** Access to one athlete on intervals.icu. Dates are inclusive YYYY-MM-DD local dates. */
export interface IntervalsClient {
  events(oldest: string, newest: string): Promise<IntervalsEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  /** One Activity; null when intervals.icu no longer has it. */
  activity(activityId: string): Promise<IntervalsActivity | null>;
  /** The intervals intervals.icu detected in one Activity; read it with `detectedIntervals`. */
  intervals(activityId: string): Promise<unknown>;
  /** One Activity's time, heart-rate, cadence and speed streams; read them with `activityStreams`. */
  streams(activityId: string): Promise<unknown>;
  /** The athlete with their sport settings; read it with `runThresholdPace`, `runMaxHr` and `runLthr`. */
  athlete(): Promise<unknown>;
  /** The athlete's wellness record for one day; read its Fitness and Fatigue with `wellnessFitness`. */
  wellness(date: string): Promise<unknown>;
  /** Replaces the given fields of the athlete's Run settings, in bpm, and recalculates its heart-rate zones. */
  updateRunSportSettings(fields: { lthr?: number; max_hr?: number }): Promise<void>;
  /** Creates a calendar event, responding with it as stored. */
  createEvent(event: object): Promise<IntervalsEvent>;
  /** Replaces the given fields of a calendar event, responding with it as stored. */
  updateEvent(eventId: number, event: object): Promise<IntervalsEvent>;
  deleteEvent(eventId: number): Promise<void>;
}

/** How much of an error response to keep; enough for intervals.icu's message, not a whole HTML page. */
const ERROR_BODY_CHARS = 200;
const NOT_FOUND = 404;
/** The streams fetched for every Activity and Cross-Training workout. */
const STREAM_TYPES = "time,heartrate,cadence,velocity_smooth";

export function createIntervalsClient(athleteId: string, apiKey: string): IntervalsClient {
  const athlete = `athlete/${encodeURIComponent(athleteId)}`;
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return read<T>(path, await request(path, params));
  }

  /** Like `get`, but null when intervals.icu answers 404 Not Found. */
  async function getIfFound<T>(path: string): Promise<T | null> {
    const res = await request(path);
    return res.status === NOT_FOUND ? null : read<T>(path, res);
  }

  function request(path: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
    const url = new URL(`https://intervals.icu/api/v1/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return fetch(url, { ...init, headers: { authorization, accept: "application/json", "content-type": "application/json" } });
  }

  async function send<T>(method: "POST" | "PUT", path: string, body: unknown, params: Record<string, string> = {}): Promise<T> {
    return read<T>(path, await request(path, params, { method, body: JSON.stringify(body) }));
  }

  async function remove(path: string): Promise<void> {
    const res = await request(path, {}, { method: "DELETE" });
    if (!res.ok) throw new Error(`intervals.icu ${path} failed: ${res.status} ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`);
  }

  async function read<T>(path: string, res: Response): Promise<T> {
    if (!res.ok) throw new Error(`intervals.icu ${path} failed: ${res.status} ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`);
    return (await res.json()) as T;
  }

  return {
    events: (oldest, newest) => get(`${athlete}/events`, { oldest, newest, category: "WORKOUT" }),
    activities: (oldest, newest) => get(`${athlete}/activities`, { oldest, newest }),
    activity: (activityId) => getIfFound(`activity/${encodeURIComponent(activityId)}`),
    intervals: (activityId) => get(`activity/${encodeURIComponent(activityId)}/intervals`),
    streams: (activityId) => get(`activity/${encodeURIComponent(activityId)}/streams`, { types: STREAM_TYPES }),
    athlete: () => get(athlete),
    wellness: (date) => get(`${athlete}/wellness/${encodeURIComponent(date)}`),
    createEvent: (event) => send("POST", `${athlete}/events`, event),
    updateEvent: (eventId, event) => send("PUT", `${athlete}/events/${eventId}`, event),
    deleteEvent: (eventId) => remove(`${athlete}/events/${eventId}`),
    updateRunSportSettings: async (fields) => {
      await send("PUT", `${athlete}/sport-settings/Run`, fields, { recalcHrZones: "true" });
    },
  };
}
