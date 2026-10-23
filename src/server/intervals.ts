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

/** Read access to one athlete on intervals.icu. Dates are inclusive YYYY-MM-DD local dates. */
export interface IntervalsClient {
  events(oldest: string, newest: string): Promise<IntervalsEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  /** The intervals intervals.icu detected in one Activity; read it with `detectedIntervals`. */
  intervals(activityId: string): Promise<unknown>;
}

/** How much of an error response to keep; enough for intervals.icu's message, not a whole HTML page. */
const ERROR_BODY_CHARS = 200;

export function createIntervalsClient(athleteId: string, apiKey: string): IntervalsClient {
  const athlete = `athlete/${encodeURIComponent(athleteId)}`;
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://intervals.icu/api/v1/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization, accept: "application/json" } });
    if (!res.ok) throw new Error(`intervals.icu ${path} failed: ${res.status} ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`);
    return (await res.json()) as T;
  }

  return {
    events: (oldest, newest) => get(`${athlete}/events`, { oldest, newest, category: "WORKOUT" }),
    activities: (oldest, newest) => get(`${athlete}/activities`, { oldest, newest }),
    intervals: (activityId) => get(`activity/${encodeURIComponent(activityId)}/intervals`),
  };
}
