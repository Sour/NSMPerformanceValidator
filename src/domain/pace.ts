const METRES_PER_MILE = 1609.344;

/** The pace, in seconds per mile, of a speed in metres per second. */
export function secondsPerMile(metresPerSecond: number): number {
  return METRES_PER_MILE / metresPerSecond;
}

/** A distance in metres as miles. */
export function miles(metres: number): number {
  return metres / METRES_PER_MILE;
}

/** Seconds as m:ss, e.g. 425 as "7:05"; for paces and Rep Lengths alike. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Seconds as h:mm, e.g. 5400 as "1:30"; for planned and run time. */
export function formatHoursMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
