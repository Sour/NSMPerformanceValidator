import { useEffect, useRef, useState } from "react";
import type { VolumeWeek } from "../domain/weeklyVolume";
import type { ProgressResponse, SyncStatusResponse, VolumeResponse, WeekActivity, WeekResponse } from "../server/app";
import { formatDate, formatDateTime, formatVolume } from "./format";
import { RepCards } from "./RepCards";
import { VolumeChart } from "./VolumeChart";

export function App() {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [volume, setVolume] = useState<VolumeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      getJson<WeekResponse>("/api/week").then(setWeek),
      getJson<ProgressResponse>("/api/progress").then(setProgress),
      getJson<VolumeResponse>("/api/volume").then(setVolume),
    ]).then(() => {});

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main><p className="error">Could not load: {error}</p></main>;
  if (!week || !progress || !volume) return <main><p>Loading…</p></main>;

  return (
    <main>
      <SyncBar onSynced={load} />
      <h1>Rep GAP</h1>
      <RepCards cards={progress.cards} />

      <h1 className="section-title">Weekly Volume</h1>
      <VolumeChart weeks={volume.weeks} />

      <h1 className="section-title">This Training Week</h1>
      <p className="range">
        {formatDate(week.start)} – {formatDate(week.end)}
      </p>
      <WeekVolume weeks={volume.weeks} start={week.start} />

      <ol className="days">
        {week.days.map((day) => (
          <li key={day.date} className={day.date === week.today ? "day today" : "day"}>
            <h2>{formatDate(day.date, true)}</h2>
            {day.workouts.length === 0 && <p className="rest">No Planned Workout</p>}
            {day.workouts.map((w) => (
              <div key={w.plannedWorkout.id} className="workout">
                <span className={`status ${w.status.toLowerCase()}`}>{w.status}</span>
                <span className="name">{w.plannedWorkout.name}</span>
                {w.runType && <span className="run-type">{w.runType}</span>}
                {w.completion && <span className={`completion ${w.completion.toLowerCase()}`}>{w.completion}</span>}
                {w.activity && <ActivitySummary activity={w.activity} />}
              </div>
            ))}
          </li>
        ))}
      </ol>

      <h2>Unplanned Runs</h2>
      {week.unplannedRuns.length === 0 ? (
        <p className="rest">None this week</p>
      ) : (
        <ul className="unplanned">
          {week.unplannedRuns.map((a) => (
            <li key={a.id}>
              {formatDate(a.date, true)} · {a.name} · <ActivitySummary activity={a} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** How often the page checks for syncs it did not start, such as scheduled ones. */
const SYNC_POLL_MS = 60_000;

/** Shows the latest sync and offers Sync now; calls `onSynced` whenever a sync has finished since the page loaded. */
function SyncBar({ onSynced }: { onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const seenFinishedAt = useRef<string | null | undefined>(undefined);

  async function show(next: SyncStatusResponse) {
    setStatus(next);
    const isNewSync = seenFinishedAt.current !== undefined && next.lastFinishedAt !== seenFinishedAt.current;
    seenFinishedAt.current = next.lastFinishedAt;
    if (isNewSync) await onSynced();
  }

  async function request(init?: RequestInit) {
    try {
      await show(await getJson<SyncStatusResponse>("/api/sync", init));
      setRequestError(null);
    } catch (e) {
      setRequestError((e as Error).message);
    }
  }

  useEffect(() => {
    void request();
    const timer = setInterval(() => void request(), SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function syncNow() {
    setSyncing(true);
    await request({ method: "POST" });
    setSyncing(false);
  }

  const running = syncing || status?.running;
  return (
    <div className="sync">
      <span className="sync-time">
        {running
          ? "Syncing…"
          : status?.lastSucceededAt
            ? `Last synced ${formatDateTime(status.lastSucceededAt)}`
            : "Not synced yet"}
      </span>
      <button type="button" onClick={syncNow} disabled={running}>
        Sync now
      </button>
      {status?.lastError && (
        <p className="error">
          Last sync failed {status.lastFinishedAt && formatDateTime(status.lastFinishedAt)}: {status.lastError}
        </p>
      )}
      {requestError && <p className="error">Could not reach the server: {requestError}</p>}
    </div>
  );
}

/** This Training Week's volume so far against last week's total. */
function WeekVolume({ weeks, start }: { weeks: VolumeWeek[]; start: string }) {
  const i = weeks.findIndex((w) => w.start === start);
  const thisWeek = weeks[i];
  if (!thisWeek) return null;
  const lastWeek = weeks[i - 1];
  return (
    <p className="week-volume">
      <strong>{formatVolume(thisWeek.total)}</strong> so far
      {lastWeek && <span className="range"> · last week {formatVolume(lastWeek.total)}</span>}
    </p>
  );
}

function ActivitySummary({ activity }: { activity: WeekActivity }) {
  const minutes = Math.round(activity.movingTime / 60);
  const km = activity.distance === null ? null : (activity.distance / 1000).toFixed(1);
  return (
    <span className="activity">
      {km !== null && `${km} km · `}
      {minutes} min
    </span>
  );
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
