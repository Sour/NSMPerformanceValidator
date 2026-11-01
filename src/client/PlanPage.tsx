import { useEffect, useRef, useState } from "react";
import { formatDuration, formatHoursMinutes } from "../domain/pace";
import type { PlanSuggestion } from "../domain/planSuggestions";
import {
  plannedQualityShare,
  plannedRepTime,
  weekPlannedTime,
  type WeekPlanDay,
  type WeekPlanStatus,
} from "../domain/weekPlan";
import type { PlannerSettingsResponse, PlanResponse, PushResponse } from "../server/app";
import type { NsmAppWorkout } from "../server/planDestination";
import { activityUrl, formatDate, formatDateTime, formatHr } from "./format";
import { SyncBar } from "./SyncBar";

type Kind = WeekPlanDay["kind"];
const KINDS: Kind[] = ["Quality Run", "Easy Run", "Long Run", "Rest"];

/** What a day becomes when its Run Type is changed to `kind`, keeping its duration between Easy Run and Long Run. */
function dayOfKind(kind: Kind, from: WeekPlanDay): WeekPlanDay {
  switch (kind) {
    case "Quality Run":
      return { kind, reps: 4, repLength: 360, recovery: 90, warmUp: 600, coolDown: 600 };
    case "Easy Run":
    case "Long Run":
      return { kind, duration: "duration" in from ? from.duration : kind === "Easy Run" ? 45 * 60 : 80 * 60 };
    case "Rest":
      return { kind };
  }
}

/** What the runner has confirmed for a push. */
type PushOptions = { replaceNsmApp?: boolean; overwrite?: boolean };

/** A push waiting on the runner: to replace NSM-app workouts, or to overwrite a change made on intervals.icu. */
type Confirmation = { kind: "replace"; workouts: NsmAppWorkout[] } | { kind: "overwrite" };

/** Plan: lay out a Week Plan for the current or next Training Week, check it against Plan Suggestions, and push it. */
export function PlanPage() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // The week being viewed, null for next week; and the latest save, so a slower earlier response is dropped.
  const viewedWeek = useRef<string | null>(null);
  const latestSave = useRef(0);
  // What the runner has confirmed for the push under way, so a push asked both questions goes through.
  const pushOptions = useRef<PushOptions>({});

  const load = () =>
    request<PlanResponse>(viewedWeek.current === null ? "/api/plan" : `/api/plan?week=${viewedWeek.current}`).then((p) => {
      if (viewedWeek.current === null || viewedWeek.current === p.week) setPlan(p);
    });

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main><p className="error">Could not load: {error}</p></main>;
  if (!plan) return <main><p>Loading…</p></main>;

  const days = plan.days.map((d) => d.day);

  const viewWeek = (week: string) => {
    viewedWeek.current = week;
    setConfirmation(null);
    setActionError(null);
    load().catch((e: Error) => setActionError(e.message));
  };

  /** Shows `edited` at once, with its summary, and saves it as the draft. */
  const edit = (edited: WeekPlanDay[]) => {
    const save = ++latestSave.current;
    setPlan({
      ...plan,
      days: plan.days.map((d, i) => ({ ...d, day: edited[i]! })),
      status: plan.status === "Draft" ? "Draft" : "Unpushed changes",
      summary: {
        ...plan.summary,
        plannedTime: weekPlannedTime(edited),
        repTime: plannedRepTime(edited),
        plannedQualityShare: plannedQualityShare(edited),
      },
    });
    request<PlanResponse>(`/api/plan/${plan.week}`, { method: "PUT", body: { days: edited } })
      .then((saved) => {
        if (save === latestSave.current) setPlan(saved);
        setActionError(null);
      })
      .catch((e: Error) => {
        setActionError(`Could not save: ${e.message}`);
        if (save === latestSave.current) void load();
      });
  };

  /** Runs one action against the server and shows the Week Plan it responds with. */
  const act = async (action: () => Promise<PlanResponse | null>) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      if (next) setPlan(next);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const push = (options: PushOptions) =>
    act(async () => {
      setConfirmation(null);
      const res = await fetch(`/api/plan/${plan.week}/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options),
      });
      const body = (await res.json().catch(() => null)) as PushResponse | { error: string } | null;
      if (!body || !("outcome" in body)) throw new Error(body?.error ?? `HTTP ${res.status}`);
      switch (body.outcome) {
        case "ConfirmReplace":
          setConfirmation({ kind: "replace", workouts: body.nsmAppWorkouts });
          return null;
        case "ConfirmOverwrite":
          setConfirmation({ kind: "overwrite" });
          return null;
        case "Failed":
          setActionError(`Push stopped: ${body.error}. Days pushed before it are kept; push again to finish.`);
          return body.plan;
        case "Pushed":
          return body.plan;
      }
    });
  const confirmAndPush = (more: PushOptions) => {
    pushOptions.current = { ...pushOptions.current, ...more };
    return push(pushOptions.current);
  };

  const suggestion = (s: PlanSuggestion, action: "accept" | "dismiss") =>
    act(() => request<PlanResponse>(`/api/plan/${plan.week}/suggestions/${encodeURIComponent(s.id)}/${action}`, { method: "POST" }));

  const editableDates = plan.days.filter((d) => d.editable).map((d) => d.date);
  const isNext = plan.week === plan.next;

  return (
    <main>
      <SyncBar onSynced={load} />
      <h1>{isNext ? "Next Training Week" : "This Training Week"}</h1>
      <div className="week-nav">
        <button type="button" onClick={() => viewWeek(plan.current)} disabled={!isNext} aria-label="This Training Week">
          ‹
        </button>
        <span className="range">
          {formatDate(plan.week)} – {formatDate(plan.days[6]!.date)}
        </span>
        <button type="button" onClick={() => viewWeek(plan.next)} disabled={isNext} aria-label="Next Training Week">
          ›
        </button>
        <span className={`plan-status ${statusClass(plan.status)}`}>{plan.status}</span>
        {plan.pushedAt && <span className="range">pushed {formatDateTime(plan.pushedAt)}</span>}
      </div>

      <Summary plan={plan} />

      <ol className="days">
        {plan.days.map((d, i) => (
          <li key={d.date} className={d.date === plan.today ? "day today" : "day"}>
            <h2>{formatDate(d.date, true)}</h2>
            {d.editable ? (
              <DayEditor
                day={d.day}
                moveTargets={editableDates.filter((date) => date !== d.date)}
                onChange={(day) => edit(days.map((x, j) => (j === i ? day : x)))}
                onMove={(date) => {
                  const j = plan.days.findIndex((x) => x.date === date);
                  const moved = [...days];
                  [moved[i], moved[j]] = [moved[j]!, moved[i]!];
                  edit(moved);
                }}
              />
            ) : (
              <p className="rest">{describe(d.day)}</p>
            )}
          </li>
        ))}
      </ol>

      {plan.suggestions.length > 0 && (
        <>
          <h2>Plan Suggestions</h2>
          <ul className="suggestions">
            {plan.suggestions.map((s) => (
              <li key={s.id} className="suggestion">
                <span className="suggestion-kind">
                  {s.kind}
                  {s.date && ` · ${formatDate(s.date, true)}`}
                </span>
                <p>{s.message}</p>
                {s.runs.length > 0 && (
                  <ul className="suggestion-runs">
                    {s.runs.map((r) => (
                      <li key={r.activityId}>
                        <a className="activity-link" href={activityUrl(r.activityId)} target="_blank" rel="noreferrer">
                          {formatDate(r.date, true)}
                        </a>{" "}
                        {r.name}
                        {r.flags.length > 0 ? <span className="over-target"> · {r.flags.join(", ")}</span> : " · fine"}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="actions">
                  {s.proposal && (
                    <button type="button" disabled={busy} onClick={() => suggestion(s, "accept")}>
                      Accept
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => suggestion(s, "dismiss")}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {confirmation && (
        <div className="confirm" role="alertdialog" aria-label="Confirm push">
          {confirmation.kind === "replace" ? (
            <>
              <p>
                Replace {confirmation.workouts.length} NSM-app workout{confirmation.workouts.length === 1 ? "" : "s"}? They
                will be deleted from intervals.icu:
              </p>
              <ul>
                {confirmation.workouts.map((w) => (
                  <li key={w.id}>
                    {formatDate(w.date, true)} · {w.name}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button type="button" onClick={() => confirmAndPush({ replaceNsmApp: true })}>
                  Replace and push
                </button>
                <button type="button" onClick={() => setConfirmation(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p>A pushed Planned Workout was changed on intervals.icu. Pushing overwrites that change with this Week Plan.</p>
              <div className="actions">
                <button type="button" onClick={() => confirmAndPush({ overwrite: true })}>
                  Push anyway
                </button>
                <button type="button" onClick={() => setConfirmation(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="actions plan-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || editableDates.length === 0}
          onClick={() => {
            pushOptions.current = {};
            void push({});
          }}
        >
          Push week
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => request<PlanResponse>(`/api/plan/${plan.week}/discard`, { method: "POST" }))}
        >
          Discard draft
        </button>
      </div>
      {actionError && <p className="error">{actionError}</p>}

      <h2>Planner settings</h2>
      <Settings settings={plan.settings} onSaved={() => load().catch((e: Error) => setActionError(e.message))} />
    </main>
  );
}

function Summary({ plan }: { plan: PlanResponse }) {
  const { plannedTime, repTime, plannedQualityShare, qualityShareTarget } = plan.summary;
  return (
    <p className="week-volume">
      <strong>{formatHoursMinutes(plannedTime)}</strong> planned
      <span className="range">
        {" "}
        · Reps {formatHoursMinutes(repTime)} · Planned Quality Share{" "}
        {plannedQualityShare === null ? "–" : `${plannedQualityShare}%`} against a {qualityShareTarget}% target
      </span>
    </p>
  );
}

function DayEditor({
  day,
  moveTargets,
  onChange,
  onMove,
}: {
  day: WeekPlanDay;
  moveTargets: string[];
  onChange: (day: WeekPlanDay) => void;
  onMove: (date: string) => void;
}) {
  return (
    <div className="plan-day">
      <select aria-label="Run Type" value={day.kind} onChange={(e) => onChange(dayOfKind(e.target.value as Kind, day))}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k === "Rest" ? "Rest day" : k}
          </option>
        ))}
      </select>
      {day.kind === "Quality Run" && (
        <>
          <label>
            <input
              type="number"
              min={1}
              value={day.reps}
              aria-label="Reps"
              onChange={(e) => Number(e.target.value) >= 1 && onChange({ ...day, reps: Math.round(Number(e.target.value)) })}
            />
            ×
          </label>
          <DurationField label="Rep Length" seconds={day.repLength} min={1} onChange={(repLength) => onChange({ ...day, repLength })} />
          <DurationField label="recovery" seconds={day.recovery} onChange={(recovery) => onChange({ ...day, recovery })} />
          <DurationField label="warm-up" seconds={day.warmUp} onChange={(warmUp) => onChange({ ...day, warmUp })} />
          <DurationField label="cool-down" seconds={day.coolDown} onChange={(coolDown) => onChange({ ...day, coolDown })} />
        </>
      )}
      {(day.kind === "Easy Run" || day.kind === "Long Run") && (
        <label>
          <input
            type="number"
            min={1}
            value={Math.round(day.duration / 60)}
            aria-label="Duration in minutes"
            onChange={(e) => Number(e.target.value) >= 1 && onChange({ ...day, duration: Math.round(Number(e.target.value)) * 60 })}
          />
          min
        </label>
      )}
      {day.kind !== "Rest" && moveTargets.length > 0 && (
        <select aria-label="Move to" value="" onChange={(e) => e.target.value && onMove(e.target.value)}>
          <option value="">Move to…</option>
          {moveTargets.map((date) => (
            <option key={date} value={date}>
              {formatDate(date, true)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** A Rep Length, recovery, warm-up or cool-down typed as m:ss, or as whole minutes; saved when it is left or Enter is pressed. */
function DurationField({
  label,
  seconds,
  min = 0,
  onChange,
}: {
  label: string;
  seconds: number;
  min?: number;
  onChange: (seconds: number) => void;
}) {
  const [text, setText] = useState(formatDuration(seconds));
  useEffect(() => setText(formatDuration(seconds)), [seconds]);
  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed !== null && parsed >= min) {
      if (parsed !== seconds) onChange(parsed);
    } else {
      setText(formatDuration(seconds));
    }
  };
  return (
    <label>
      <input
        className="duration"
        value={text}
        aria-label={label}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {label}
    </label>
  );
}

/** "6:00" or "6" (minutes) as seconds; null when it is neither. */
function parseDuration(text: string): number | null {
  const match = /^\s*(\d+)(?::(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const s = Number(match[2] ?? 0);
  return s < 60 ? Number(match[1]) * 60 + s : null;
}

/** A day as text, for days that can no longer be edited. */
function describe(day: WeekPlanDay): string {
  switch (day.kind) {
    case "Quality Run":
      return `${day.reps} × ${formatDuration(day.repLength)}, ${formatDuration(day.recovery)} rec · ${formatDuration(day.warmUp)} warm-up · ${formatDuration(day.coolDown)} cool-down`;
    case "Easy Run":
    case "Long Run":
      return `${day.kind} · ${Math.round(day.duration / 60)} min`;
    case "Rest":
      return "Rest day";
  }
}

function statusClass(status: WeekPlanStatus): string {
  return status.toLowerCase().replace(/[^a-z]+/g, "-");
}

function Settings({ settings, onSaved }: { settings: PlannerSettingsResponse; onSaved: () => void }) {
  const [low, setLow] = useState(String(settings.easyHrTarget?.low ?? ""));
  const [high, setHigh] = useState(String(settings.easyHrTarget?.high ?? ""));
  const [target, setTarget] = useState(String(settings.qualityShareTarget));
  // Until edited, the Easy HR Target is left out of a save, so it keeps following the current one.
  const [easyEdited, setEasyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const easyHrTarget = easyEdited ? { easyHrTarget: { low: Number(low), high: Number(high) } } : {};
    try {
      await request<PlannerSettingsResponse>("/api/planner-settings", {
        method: "PUT",
        body: { ...easyHrTarget, qualityShareTarget: Number(target) },
      });
      setError(null);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="planner-settings" onSubmit={save}>
      <label>
        Easy HR Target
        <span>
          <input type="number" min={0} max={100} value={low} onChange={(e) => {
              setLow(e.target.value);
              setEasyEdited(true);
            }} aria-label="Easy HR Target low" />
          –
          <input type="number" min={0} max={100} value={high} onChange={(e) => {
              setHigh(e.target.value);
              setEasyEdited(true);
            }} aria-label="Easy HR Target high" />
          % of Max HR
        </span>
      </label>
      <label>
        Quality Share Target
        <span>
          <input type="number" min={0} max={100} value={target} onChange={(e) => setTarget(e.target.value)} />%
        </span>
      </label>
      <p className="range">
        LTHR {settings.lthr === null ? "not set" : formatHr(settings.lthr)} · Max HR{" "}
        {settings.maxHr === null ? "not set" : formatHr(settings.maxHr)}, from intervals.icu (change them there, then sync)
      </p>
      <div className="actions">
        <button type="submit">Save settings</button>
        {saved && <span className="range">Saved</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/** A JSON request whose error responses carry `{ error }`, thrown as that message. */
async function request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return body as T;
}
