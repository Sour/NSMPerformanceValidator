import { useEffect, useState } from "react";
import type { WeekActivity, WeekResponse } from "../server/app";

export function App() {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/week")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setWeek, (e: Error) => setError(e.message));
  }, []);

  if (error) return <main><p className="error">Could not load this Training Week: {error}</p></main>;
  if (!week) return <main><p>Loading…</p></main>;

  return (
    <main>
      <h1>This Training Week</h1>
      <p className="range">
        {formatDate(week.start)} – {formatDate(week.end)}
      </p>

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

function formatDate(date: string, withWeekday = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
  });
}
