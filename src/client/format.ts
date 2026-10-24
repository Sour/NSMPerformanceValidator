import { formatDuration, miles, secondsPerMile } from "../domain/pace";
import type { Volume } from "../domain/weeklyVolume";

/** A Format as written in the plan, e.g. "4 × 6:00, 1:30 rec". */
export function formatText(reps: number, repLength: number, recovery: number | null): string {
  return `${reps} × ${formatDuration(repLength)}${recovery === null ? "" : `, ${formatDuration(recovery)} rec`}`;
}

/** Seconds as h:mm, e.g. 5400 as "1:30". */
export function formatHoursMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

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
