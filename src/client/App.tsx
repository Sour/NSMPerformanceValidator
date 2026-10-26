import { useEffect, useRef, useState } from "react";
import { addDays } from "../domain/localDate";
import { weekStart } from "../domain/trainingWeek";
import type { VolumeWeek } from "../domain/weeklyVolume";
import type {
  EasyResponse,
  ProgressResponse,
  SyncStatusResponse,
  ThresholdsResponse,
  VolumeResponse,
  WeekActivity,
  WeekResponse,
} from "../server/app";
import { EasyChart } from "./EasyChart";
import { formatDate, formatDateTime, formatVolume } from "./format";
import { RepCards } from "./RepCards";
import { ThresholdPaces } from "./ThresholdPaces";
import { VolumeChart } from "./VolumeChart";

export function App() {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [volume, setVolume] = useState<VolumeResponse | null>(null);
  const [easy, setEasy] = useState<EasyResponse | null>(null);
  const [thresholds, setThresholds] = useState<ThresholdsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A date in the Training Week being viewed; null for the current one. A ref, so reloads after a sync keep the week.
  const viewedWeek = useRef<string | null>(null);

  const loadWeek = () => {
    const date = viewedWeek.current;
    return getJson<WeekResponse>(date === null ? "/api/week" : `/api/week?date=${date}`).then((w) => {
      // A slower response for a week no longer being viewed is dropped.
      if (viewedWeek.current === date) setWeek(w);
    });
  };
  const viewWeek = (date: string | null) => {
    viewedWeek.current = date;
    loadWeek().catch((e: Error) => setError(e.message));
  };
  /** Moves `weeks` Training Weeks from the one last asked for, so quick clicks add up, staying within the range. */
  const stepWeek = (weeks: number) => {
    const to = addDays(weekStart(viewedWeek.current ?? week!.today), 7 * weeks);
    if (to >= week!.earliest && to <= week!.latest) viewWeek(to);
  };

  const load = () =>
    Promise.all([
      loadWeek(),
      getJson<ProgressResponse>("/api/progress").then(setProgress),
      getJson<VolumeResponse>("/api/volume").then(setVolume),
      getJson<EasyResponse>("/api/easy").then(setEasy),
      getJson<ThresholdsResponse>("/api/thresholds").then(setThresholds),
    ]).then(() => {});

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main><p className="error">Could not load: {error}</p></main>;
  if (!week || !progress || !volume || !easy || !thresholds) return <main><p>Loading…</p></main>;
  const isThisWeek = week.today >= week.start && week.today <= week.end;

  return (
    <main>
      <SyncBar onSynced={load} />
      <h1>LT1 Pace / LT2 Pace</h1>
      <ThresholdPaces thresholds={thresholds} />

      <h1 className="section-title">Rep GAP</h1>
      <RepCards cards={progress.cards} onRefetched={load} />

      <h1 className="section-title">Weekly Volume</h1>
      <VolumeChart weeks={volume.weeks} />

      <h1 className="section-title">Easy GAP / Easy HR / Easy Efficiency</h1>
      <EasyChart runs={easy.runs} />

      <h1 className="section-title">{isThisWeek ? "This Training Week" : "Training Week"}</h1>
      <div className="week-nav">
        <button
          type="button"
          onClick={() => stepWeek(-1)}
          disabled={week.start <= week.earliest}
          aria-label="Previous Training Week"
        >
          ‹
        </button>
        <span className="range">
          {formatDate(week.start)} – {formatDate(week.end)}
        </span>
        <button
          type="button"
          onClick={() => stepWeek(1)}
          disabled={week.start >= week.latest}
          aria-label="Next Training Week"
        >
          ›
        </button>
        {!isThisWeek && (
          <button type="button" className="link" onClick={() => viewWeek(null)}>
            This week
          </button>
        )}
      </div>
      <WeekVolume weeks={volume.weeks} start={week.start} isThisWeek={isThisWeek} />

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
        <p className="rest">None {isThisWeek ? "this" : "that"} week</p>
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

/**
 * The viewed Training Week's volume, so far when it is this week, against the week before's total.
 * Nothing for an upcoming week.
 */
function WeekVolume({ weeks, start, isThisWeek }: { weeks: VolumeWeek[]; start: string; isThisWeek: boolean }) {
  const i = weeks.findIndex((w) => w.start === start);
  const viewed = weeks[i];
  if (!viewed) return null;
  const before = weeks[i - 1];
  return (
    <p className="week-volume">
      <strong>{formatVolume(viewed.total)}</strong>
      {isThisWeek && " so far"}
      {before && (
        <span className="range">
          {" "}
          · {isThisWeek ? "last week" : "week before"} {formatVolume(before.total)}
        </span>
      )}
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
