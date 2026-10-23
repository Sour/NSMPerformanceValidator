import { qualityRunFormat } from "./qualityRun";

export type RunType = "Quality Run" | "Easy Run" | "Long Run";

/** The Run Type of a Planned Workout, read from its name; null when the name fits none. */
export function runType(plannedWorkoutName: string): RunType | null {
  if (qualityRunFormat(plannedWorkoutName)) return "Quality Run";
  if (/\blong run\b/i.test(plannedWorkoutName)) return "Long Run";
  if (/\beasy run\b/i.test(plannedWorkoutName)) return "Easy Run";
  return null;
}
