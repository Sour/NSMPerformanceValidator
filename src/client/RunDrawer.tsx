import { useEffect, useRef, useState } from "react";
import { formatDuration, secondsPerMile } from "../domain/pace";
import type { RepLengthRun } from "../domain/repProgress";
import type { RefetchResponse } from "../server/app";
import { formatDate, formatDateTime, formatText } from "./format";

/**
 * The run detail drawer for one Quality Run: its Rep GAP and Rep HR, a bar per Rep, a link to the Activity,
 * and Re-fetch. After a Re-fetch, `onRefetched` reloads the page, which brings the drawer the run as it now is;
 * when its Activity is no longer Matched to a Quality Run, `onGone` is told why instead.
 */
export function RunDrawer({
  run,
  onClose,
  onRefetched,
  onGone,
}: {
  run: RepLengthRun;
  onClose: () => void;
  onRefetched: () => Promise<void>;
  onGone: (message: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [refetching, setRefetching] = useState(false);
  const [refetchError, setRefetchError] = useState<string | null>(null);

  async function refetch() {
    setRefetching(true);
    setRefetchError(null);
    let outcome: RefetchResponse["outcome"];
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(run.activityId)}/refetch`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as RefetchResponse | { error: string } | null;
      if (!res.ok || !body || "error" in body) throw new Error(body && "error" in body ? body.error : `HTTP ${res.status}`);
      outcome = body.outcome;
    } catch (e) {
      setRefetchError(`Re-fetch failed: ${(e as Error).message}`);
      setRefetching(false);
      return;
    }
    // The re-fetch has been stored by now, so a failed reload is not a failed re-fetch.
    try {
      if (outcome === "Updated") await onRefetched();
      else await onGone(GONE[outcome](formatDate(run.date)));
    } catch (e) {
      setRefetchError(`Re-fetched, but the page could not reload: ${(e as Error).message}`);
    } finally {
      setRefetching(false);
    }
  }

  // Unmounting removes the dialog from the page, which closes it; closing it here instead would fire `onClose`.
  // Focus goes to the drawer itself rather than its close button.
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    dialog.focus();
  }, []);

  const gaps = run.reps.flatMap((r) => (r.gap === null ? [] : [r.gap]));
  const hrs = run.reps.flatMap((r) => (r.hr === null ? [] : [r.hr]));
  const missing = run.format.reps - run.reps.length;

  return (
    <dialog
      ref={ref}
      className="run-drawer"
      tabIndex={-1}
      aria-label={`Quality Run on ${formatDate(run.date)}`}
      onClose={onClose}
      // The dialog itself is only hit on its backdrop; its content fills it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="run-drawer-body">
        <header>
          <div>
            <h3>{formatDate(run.date, true)}</h3>
            <p className="format">{formatText(run.format.reps, run.format.repLength, run.recovery)}</p>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <dl className="totals">
          <div>
            <dt>Rep GAP</dt>
            <dd>{run.repGap === null ? "–" : `${formatDuration(secondsPerMile(run.repGap))} /mi`}</dd>
          </div>
          <div>
            <dt>Rep HR</dt>
            <dd>{run.repHr === null ? "–" : `${Math.round(run.repHr)} bpm`}</dd>
          </div>
        </dl>

        {run.overTarget && (
          <p className="note over-target">
            Over Target: {repList(run.reps.flatMap((r, i) => (r.aboveCeiling ? [i + 1] : [])))} averaged above{" "}
            {run.hrCeiling} bpm, so this pace overstates fitness.
          </p>
        )}
        {!run.complete && (
          <p className="note incomplete">
            Incomplete: {missing === run.format.reps ? "no Reps" : `${missing} of ${run.format.reps} planned Reps not`}{" "}
            found, so this run is not trended.
          </p>
        )}

        <ol className="rep-bars">
          {run.reps.length > 0 && (
            <li className="rep-bars-head" aria-hidden="true">
              <span />
              <span>GAP /mi · longer is faster</span>
              <span>HR bpm</span>
            </li>
          )}
          {run.reps.map((r, i) => (
            <li key={i}>
              <span className="rep-label">Rep {i + 1}</span>
              <Bar
                width={r.gap === null ? null : barWidth(r.gap, gaps)}
                label={r.gap === null ? "–" : formatDuration(secondsPerMile(r.gap))}
                className="gap"
              />
              <Bar
                width={r.hr === null ? null : barWidth(r.hr, hrs)}
                label={r.hr === null ? "–" : String(Math.round(r.hr))}
                className={r.aboveCeiling ? "hr over-target" : "hr"}
              />
            </li>
          ))}
          {missing > 0 && (
            <li className="missing">
              <span className="not-found">
                {missing} {missing === 1 ? "Rep" : "Reps"} not found
              </span>
            </li>
          )}
        </ol>

        <a className="activity-link" href={activityUrl(run.activityId)} target="_blank" rel="noreferrer">
          View Activity on intervals.icu ↗
        </a>

        <div className="refetch">
          {run.intervalsChangedAt !== null && (
            <p className="note">Intervals changed {formatDateTime(run.intervalsChangedAt)}</p>
          )}
          <button type="button" onClick={refetch} disabled={refetching}>
            {refetching ? "Re-fetching…" : "Re-fetch from intervals.icu"}
          </button>
          {refetchError && <p className="error">{refetchError}</p>}
        </div>
      </div>
    </dialog>
  );
}

/** What the card says when a re-fetched Activity is no longer Matched to a Quality Run, given the run's date. */
const GONE: Record<Exclude<RefetchResponse["outcome"], "Updated">, (date: string) => string> = {
  Deleted: (date) => `The Activity on ${date} no longer exists on intervals.icu, so it has been removed.`,
  NotQualityRun: (date) => `The Activity on ${date} is no longer Matched to this Quality Run.`,
};

function Bar({ width, label, className }: { width: number | null; label: string; className: string }) {
  return (
    <span className={`bar ${className}`}>
      {width !== null && <span className="fill" style={{ width: `${width}%` }} />}
      <span className="value">{label}</span>
    </span>
  );
}

/**
 * A bar's width as a percentage, scaled within the run so fade across Reps is visible:
 * the largest value fills the bar and the smallest fills half of it.
 */
function barWidth(value: number, values: number[]): number {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const floor = min - Math.max(max - min, max * 0.02);
  return (100 * (value - floor)) / (max - floor);
}

/** Rep numbers as prose, e.g. "Rep 2", "Reps 4 and 5", "Reps 1, 3 and 4". */
function repList(numbers: number[]): string {
  if (numbers.length === 1) return `Rep ${numbers[0]}`;
  return `Reps ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
}

function activityUrl(activityId: string): string {
  return `https://intervals.icu/activities/${encodeURIComponent(activityId)}`;
}
