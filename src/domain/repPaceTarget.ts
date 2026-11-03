import type { RepLengthRun } from "./repProgress";
import type { DatedDay } from "./weekPlan";

/**
 * Per Rep Length in seconds, the Rep Pace Target last given: that of the latest-dated Quality Run of that Rep Length
 * with one, whatever its rep count or recovery. A new Quality Run of that Rep Length starts with it.
 */
export function lastRepPaceTargets(days: DatedDay[]): Record<number, number> {
  const latest: Record<number, { date: string; pace: number }> = {};
  for (const { date, day } of days) {
    if (day.kind !== "Quality Run" || day.repPaceTarget === undefined) continue;
    const seen = latest[day.repLength];
    if (!seen || date >= seen.date) latest[day.repLength] = { date, pace: day.repPaceTarget };
  }
  return Object.fromEntries(Object.entries(latest).map(([repLength, { pace }]) => [repLength, pace]));
}

/** The Rep GAP shown beside a Rep Pace Target: what the latest Complete Quality Run of its Rep Length ran. */
export interface RecentRepGap {
  date: string;
  /** Grade-adjusted speed in metres per second. */
  repGap: number;
  overTarget: boolean;
}

/** Per Rep Length in seconds, the Rep GAP of the latest Complete Quality Run of that Rep Length with one. */
export function recentRepGaps(runs: RepLengthRun[]): Record<number, RecentRepGap> {
  const latest: Record<number, RecentRepGap> = {};
  for (const { date, format, complete, repGap, overTarget } of runs) {
    if (!complete || repGap === null) continue;
    const seen = latest[format.repLength];
    if (!seen || date >= seen.date) latest[format.repLength] = { date, repGap, overTarget };
  }
  return latest;
}
