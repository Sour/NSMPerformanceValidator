import { useEffect, useRef, useState } from "react";
import { DEFAULT_FITNESS_RANGE, isFitnessRange, type FitnessRange } from "../domain/fitness";
import { addDays } from "../domain/localDate";
import { weekStart } from "../domain/trainingWeek";
import type { VolumeWeek } from "../domain/weeklyVolume";
import type {
  EasyResponse,
  FitnessResponse,
  ProgressResponse,
  ThresholdsResponse,
  VolumeResponse,
  WeekActivity,
  WeekResponse,
} from "../server/app";
import { getJson } from "./api";
import { EasyChart } from "./EasyChart";
import { FitnessChart } from "./FitnessChart";
import { PlanPage } from "./PlanPage";
import { navigate, PAGE_PATHS, usePage, type Page } from "./router";
import { formatDate, formatVolume } from "./format";
import { RepCards } from "./RepCards";
import { SyncBar } from "./SyncBar";
import { ThresholdPaces } from "./ThresholdPaces";
import { loadViewPreference, saveViewPreference } from "./viewPreference";
import { VolumeChart } from "./VolumeChart";

const FITNESS_RANGE_PREFERENCE = "fitnessRange";

/** The Fitness range this browser last chose, or 3 months. */
function rememberedFitnessRange(): FitnessRange {
  const stored = loadViewPreference(FITNESS_RANGE_PREFERENCE);
  return stored !== null && isFitnessRange(stored) ? stored : DEFAULT_FITNESS_RANGE;
}

export function App() {
  const page = usePage();
  return (
    <>
      <nav className="top-nav" aria-label="Pages">
        {(["Progress", "Plan"] as const).map((p) => (
          <PageLink key={p} page={p} current={page} />
        ))}
      </nav>
      {page === "Plan" ? <PlanPage /> : <ProgressPage />}
    </>
  );
}

function PageLink({ page, current }: { page: Page; current: Page }) {
  return (
    <a
      href={PAGE_PATHS[page]}
      aria-current={page === current ? "page" : undefined}
      onClick={(e) => {
        // A modified click opens the page elsewhere, as for any link.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(page);
      }}
    >
      {page}
    </a>
  );
}

/** Progress: how the runs compare with what was planned. */
function ProgressPage() {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [volume, setVolume] = useState<VolumeResponse | null>(null);
  const [easy, setEasy] = useState<EasyResponse | null>(null);
  const [thresholds, setThresholds] = useState<ThresholdsResponse | null>(null);
  const [fitness, setFitness] = useState<FitnessResponse | null>(null);
  const [fitnessRange, setFitnessRange] = useState(rememberedFitnessRange);
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

  // The Fitness range being viewed, as a ref too, so a slower response for another range is dropped.
  const viewedFitnessRange = useRef(fitnessRange);
  const loadFitness = () => {
    const range = viewedFitnessRange.current;
    return getJson<FitnessResponse>(`/api/fitness?range=${range}`).then((f) => {
      if (viewedFitnessRange.current === range) setFitness(f);
    });
  };
  const viewFitnessRange = (range: FitnessRange) => {
    viewedFitnessRange.current = range;
    setFitnessRange(range);
    saveViewPreference(FITNESS_RANGE_PREFERENCE, range);
    loadFitness().catch((e: Error) => setError(e.message));
  };

  const load = () =>
    Promise.all([
      loadWeek(),
      getJson<ProgressResponse>("/api/progress").then(setProgress),
      getJson<VolumeResponse>("/api/volume").then(setVolume),
      getJson<EasyResponse>("/api/easy").then(setEasy),
      getJson<ThresholdsResponse>("/api/thresholds").then(setThresholds),
      loadFitness(),
    ]).then(() => {});

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main><p className="error">Could not load: {error}</p></main>;
  if (!week || !progress || !volume || !easy || !thresholds || !fitness) return <main><p>Loading…</p></main>;
  const isThisWeek = week.today >= week.start && week.today <= week.end;

  return (
    <main>
      <SyncBar onSynced={load} />
      <h1>LT1 Pace / LT2 Pace</h1>
      <ThresholdPaces thresholds={thresholds} />

      <h1 className="section-title">Rep GAP</h1>
      <RepCards cards={progress.cards} onRefetched={load} />

      <h1 className="section-title">Weekly Volume</h1>
      <VolumeChart weeks={volume.weeks} qualityShareTarget={volume.qualityShareTarget} />

      <h1 className="section-title">Fitness</h1>
      <FitnessChart days={fitness.days} range={fitnessRange} onRange={viewFitnessRange} />

      <h1 className="section-title">Easy Pace</h1>
      <EasyChart easy={easy} />

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
