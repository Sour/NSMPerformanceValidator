import { formatDuration } from "../domain/pace";

/** A Format as written in the plan, e.g. "4 × 6:00, 1:30 rec". */
export function formatText(reps: number, repLength: number, recovery: number | null): string {
  return `${reps} × ${formatDuration(repLength)}${recovery === null ? "" : `, ${formatDuration(recovery)} rec`}`;
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
