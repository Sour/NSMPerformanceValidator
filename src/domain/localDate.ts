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

/** 0 for Sunday through 6 for Saturday. */
export function dayOfWeek(date: string): number {
  return toUtc(date).getUTCDay();
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
