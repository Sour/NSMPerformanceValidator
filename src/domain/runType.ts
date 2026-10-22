export type RunType = "Quality Run" | "Easy Run" | "Long Run";

/** A Quality Run's name leads with its Format, e.g. "4 x 6:00 at 163–177 bpm". */
const QUALITY_RUN_FORMAT = /^\s*\d+\s*[x×]\s*\d+:\d{2}/i;

/** The Run Type of a Planned Workout, read from its name; null when the name fits none. */
export function runType(plannedWorkoutName: string): RunType | null {
  if (QUALITY_RUN_FORMAT.test(plannedWorkoutName)) return "Quality Run";
  if (/\blong run\b/i.test(plannedWorkoutName)) return "Long Run";
  if (/\beasy run\b/i.test(plannedWorkoutName)) return "Easy Run";
  return null;
}
