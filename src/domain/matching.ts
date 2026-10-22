export interface PlannedWorkout {
  id: number;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  /** intervals.icu's pairing, as seen from the Planned Workout. */
  pairedActivityId: string | null;
}

export interface Activity {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  type: string;
  name: string;
  /** Seconds. */
  movingTime: number;
  /** intervals.icu's pairing, as seen from the Activity. */
  pairedEventId: number | null;
}

export interface Match {
  plannedWorkoutId: number;
  activityId: string;
}

/** Only Activities of type Run can be Matched. */
export function isRun(a: Pick<Activity, "type">): boolean {
  return a.type === "Run";
}

export function matchActivities(planned: PlannedWorkout[], activities: Activity[]): Match[] {
  const runningActivities = activities.filter(isRun);
  const matches: Match[] = [];
  const matched = new Set<string>();
  const add = (p: PlannedWorkout, a: Activity) => {
    matches.push({ plannedWorkoutId: p.id, activityId: a.id });
    matched.add(a.id);
  };
  const isMatched = (p: PlannedWorkout) => matches.some((m) => m.plannedWorkoutId === p.id);

  for (const p of planned) {
    const paired = runningActivities.find(
      (a) => !matched.has(a.id) && (a.id === p.pairedActivityId || a.pairedEventId === p.id),
    );
    if (paired) add(p, paired);
  }
  for (const p of planned) {
    if (isMatched(p)) continue;
    const candidate = runningActivities
      .filter((a) => !matched.has(a.id) && a.date === p.date)
      .sort((x, y) => Number(namedAfter(y, p)) - Number(namedAfter(x, p)) || y.movingTime - x.movingTime)[0];
    if (candidate) add(p, candidate);
  }
  return matches;
}

function namedAfter(a: Activity, p: PlannedWorkout): boolean {
  return a.name.toLowerCase().includes(p.name.toLowerCase());
}
