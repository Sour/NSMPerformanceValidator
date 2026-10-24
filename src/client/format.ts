import { formatDuration, miles } from "../domain/pace";

/** A Format as written in the plan, e.g. "4 × 6:00, 1:30 rec". */
export function formatText(reps: number, repLength: number, recovery: number | null): string {
  return `${reps} × ${formatDuration(repLength)}${recovery === null ? "" : `, ${formatDuration(recovery)} rec`}`;
}

/** Seconds as h:mm, e.g. 5400 as "1:30". */
export function formatHours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Metres as miles to one decimal place, e.g. "6.2 mi". */
export function formatMiles(metres: number): string {
  return `${miles(metres).toFixed(1)} mi`;
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
