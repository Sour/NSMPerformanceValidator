/** Helpers for local calendar dates written as YYYY-MM-DD. */

/** The local calendar date of an intervals.icu `start_date_local` timestamp. */
export function localDate(startDateLocal: string): string {
  return startDateLocal.slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Whether `text` is a real calendar date written as YYYY-MM-DD. */
export function isLocalDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = toUtc(text);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** 0 for Sunday through 6 for Saturday. */
export function dayOfWeek(date: string): number {
  return toUtc(date).getUTCDay();
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
