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

/** Read access to one athlete on intervals.icu. Dates are inclusive YYYY-MM-DD local dates. */
export interface IntervalsClient {
  events(oldest: string, newest: string): Promise<IntervalsEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
}

export function createIntervalsClient(athleteId: string, apiKey: string): IntervalsClient {
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;

  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization, accept: "application/json" } });
    if (!res.ok) throw new Error(`intervals.icu ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    events: (oldest, newest) => get("events", { oldest, newest, category: "WORKOUT" }),
    activities: (oldest, newest) => get("activities", { oldest, newest }),
  };
}
