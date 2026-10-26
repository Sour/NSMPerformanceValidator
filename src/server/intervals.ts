import type { EasyAverages } from "../domain/easyTrend";
import { localDate } from "../domain/localDate";
import type { Activity, PlannedWorkout } from "../domain/matching";
import type { DetectedInterval } from "../domain/qualityRun";

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
  intensity?: string;
  duration?: number;
  steps?: WorkoutStep[];
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

/** The intervals intervals.icu detected in an Activity, read from its `GET /activity/{id}/intervals` response. */
export function detectedIntervals(response: unknown): DetectedInterval[] {
  const intervals = (response as { icu_intervals?: Record<string, unknown>[] } | null)?.icu_intervals ?? [];
  return intervals.map((i) => ({
    type: String(i.type),
    movingTime: Number(i.moving_time ?? 0),
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
 * The intervals.icu Threshold Pace of the athlete's Run settings, read from a `GET /athlete/{id}` response:
 * the `threshold_pace` of the sport settings covering Run, always metres per second. Null when there is none.
 */
export function runThresholdPace(athlete: unknown): number | null {
  const settings = (athlete as { sportSettings?: { types?: unknown; threshold_pace?: unknown }[] } | null)?.sportSettings;
  const run = (Array.isArray(settings) ? settings : []).find((s) => Array.isArray(s.types) && s.types.includes("Run"));
  return typeof run?.threshold_pace === "number" && run.threshold_pace > 0 ? run.threshold_pace : null;
}

/** Read access to one athlete on intervals.icu. Dates are inclusive YYYY-MM-DD local dates. */
export interface IntervalsClient {
  events(oldest: string, newest: string): Promise<IntervalsEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  /** One Activity; null when intervals.icu no longer has it. */
  activity(activityId: string): Promise<IntervalsActivity | null>;
  /** The intervals intervals.icu detected in one Activity; read it with `detectedIntervals`. */
  intervals(activityId: string): Promise<unknown>;
  /** The athlete with their sport settings; read it with `runThresholdPace`. */
  athlete(): Promise<unknown>;
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

  function request(path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`https://intervals.icu/api/v1/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return fetch(url, { headers: { authorization, accept: "application/json" } });
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
    athlete: () => get(athlete),
  };
}
