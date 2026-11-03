import { formatDuration, formatHoursMinutes, miles, secondsPerMile } from "../domain/pace";
import type { Volume } from "../domain/weeklyVolume";
import type { SyncStatusResponse } from "../server/app";

type GarminSyncStatus = SyncStatusResponse["garmin"];
type ThresholdChange = NonNullable<NonNullable<GarminSyncStatus["lastChange"]>["lthr"]>;

/** A Format as written in the plan, e.g. "4 × 6:00, 1:30 rec". */
export function formatText(reps: number, repLength: number, recovery: number | null): string {
  return `${reps} × ${formatDuration(repLength)}${recovery === null ? "" : `, ${formatDuration(recovery)} rec`}`;
}

export { formatHoursMinutes } from "../domain/pace";

/** Metres as miles to one decimal place, e.g. "6.2 mi". */
export function formatMiles(metres: number): string {
  return `${miles(metres).toFixed(1)} mi`;
}

/** A Volume as distance and time, e.g. "6.2 mi · 1:30". */
export function formatVolume(volume: Volume): string {
  return `${formatMiles(volume.distance)} · ${formatHoursMinutes(volume.movingTime)}`;
}

/** A grade-adjusted speed in metres per second as a pace, e.g. "10:42 /mi". */
export function formatPace(metresPerSecond: number): string {
  return `${formatDuration(secondsPerMile(metresPerSecond))} /mi`;
}

/** A heart rate as whole beats per minute, e.g. "139 bpm". */
export function formatHr(bpm: number): string {
  return `${Math.round(bpm)} bpm`;
}

/** A run's Aerobic Decoupling to one decimal place, e.g. "3.8%" or "−1.2%"; "–" when it has none. */
export function formatAerobicDecoupling(percent: number | null): string {
  if (percent === null) return "–";
  const rounded = percent.toFixed(1);
  return `${Number(rounded) < 0 ? "−" : ""}${Math.abs(Number(rounded)).toFixed(1)}%`;
}

/** A change in Aerobic Decoupling in percentage points, e.g. "−1.4 pts"; negative is more aerobically durable. */
export function formatAerobicDecouplingChange(points: number): string {
  const rounded = Number(points.toFixed(1));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(1)} pts`;
}

/** Text made safe to put in a chart tooltip's HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatDate(date: string, withWeekday = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
  });
}

/** An Activity's page on intervals.icu, its detail view. */
export function activityUrl(activityId: string): string {
  return `https://intervals.icu/activities/${encodeURIComponent(activityId)}`;
}

/** A timestamp's day, e.g. "2 Nov". */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const GARMIN_FAILURES = {
  KeyRejected: "Garmin key rejected",
  Unreachable: "Garmin unreachable",
  Unexpected: "Garmin gave an unexpected response",
} as const;

/** The lasting notice of a Garmin failure, e.g. "Garmin key rejected since 2 Nov: thresholds not synced. …". */
export function garminNotice({ kind, since }: NonNullable<GarminSyncStatus["failure"]>): string {
  const fix = kind === "KeyRejected" ? " If it has expired, create a new key in Garmin Connect." : "";
  return `${GARMIN_FAILURES[kind]} since ${formatDay(since)}: thresholds not synced.${fix}`;
}

/** The latest change from Garmin, e.g. "LTHR 175 → 173, Max HR 197 → 194 from Garmin, 2 Nov". */
export function thresholdChangeText({ at, lthr, maxHr }: NonNullable<GarminSyncStatus["lastChange"]>): string {
  const change = (name: string, c: ThresholdChange | null) =>
    c === null ? [] : [c.from === null ? `${name} set to ${c.to}` : `${name} ${c.from} → ${c.to}`];
  return `${[...change("LTHR", lthr), ...change("Max HR", maxHr)].join(", ")} from Garmin, ${formatDay(at)}`;
}
