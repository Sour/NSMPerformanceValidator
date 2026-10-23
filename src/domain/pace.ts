const METRES_PER_MILE = 1609.344;

/** The pace, in seconds per mile, of a speed in metres per second. */
export function secondsPerMile(metresPerSecond: number): number {
  return METRES_PER_MILE / metresPerSecond;
}

/** Seconds as m:ss, e.g. 425 as "7:05"; for paces and Rep Lengths alike. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
