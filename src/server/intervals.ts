import type { ActivityStreams } from "../domain/activityStreams";
import type { EasyAverages, EasyHrTarget } from "../domain/easyTrend";
import { localDate } from "../domain/localDate";
import type { Activity, PlannedWorkout } from "../domain/matching";
import { qualityRunFormat, type DetectedInterval } from "../domain/qualityRun";
import { runType } from "../domain/runType";
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
 * A Planned Workout as a Week Plan day, read from its name and `workout_doc`: a Quality Run's Format from the name and
 * its recovery, warm-up and cool-down from the structure (0 when it has none), or an Easy Run's or Long Run's duration.
 * Null for a Planned Workout of no Run Type.
 */
export function weekPlanDay(event: IntervalsEvent): WorkoutDay | null {
  const doc = (event as { workout_doc?: { steps?: WorkoutStep[]; duration?: unknown } | null }).workout_doc;
  const type = runType(event.name);
  if (type === "Quality Run") {
    const steps = doc?.steps ?? [];
    const stepDuration = (s: WorkoutStep | undefined) => (typeof s?.duration === "number" ? s.duration : 0);
    return {
      kind: type,
      ...qualityRunFormat(event.name)!,
      recovery: plannedRecovery(event) ?? 0,
      warmUp: stepDuration(steps.find((s) => s.warmup)),
      coolDown: stepDuration(steps.find((s) => s.cooldown)),
    };
  }
  if (type === null) return null;
  const duration = typeof doc?.duration === "number" ? doc.duration : Number(event.moving_time ?? 0);
  return { kind: type, duration };
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
 * it was not fetched; a heart-rate or cadence stream not recorded is null on its own.
 */
export function activityStreams(response: unknown): ActivityStreams | null {
  const list = Array.isArray(response) ? (response as { type?: unknown; data?: unknown }[]) : [];
  const stream = (type: string) => {
    const data = list.find((s) => s.type === type)?.data;
    return Array.isArray(data) ? data.map((v) => (typeof v === "number" ? v : null)) : null;
  };
  const time = stream("time");
  if (time === null || time.some((t) => t === null)) return null;
  return { time: time as number[], heartrate: stream("heartrate"), cadence: stream("cadence") };
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
  /** One Activity's time, heart-rate and cadence streams; read them with `activityStreams`. */
  streams(activityId: string): Promise<unknown>;
  /** The athlete with their sport settings; read it with `runThresholdPace`, `runMaxHr` and `runLthr`. */
  athlete(): Promise<unknown>;
  /** Creates a calendar event, responding with it as stored. */
  createEvent(event: object): Promise<IntervalsEvent>;
  /** Replaces the given fields of a calendar event, responding with it as stored. */
  updateEvent(eventId: number, event: object): Promise<IntervalsEvent>;
  deleteEvent(eventId: number): Promise<void>;
}

/** How much of an error response to keep; enough for intervals.icu's message, not a whole HTML page. */
const ERROR_BODY_CHARS = 200;
const NOT_FOUND = 404;

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

  async function send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
    return read<T>(path, await request(path, {}, { method, body: JSON.stringify(body) }));
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
    streams: (activityId) => get(`activity/${encodeURIComponent(activityId)}/streams`, { types: "time,heartrate,cadence" }),
    athlete: () => get(athlete),
    createEvent: (event) => send("POST", `${athlete}/events`, event),
    updateEvent: (eventId, event) => send("PUT", `${athlete}/events/${eventId}`, event),
    deleteEvent: (eventId) => remove(`${athlete}/events/${eventId}`),
  };
}
