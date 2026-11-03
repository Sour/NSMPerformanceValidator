import { movingSeconds, type ActivityStreams } from "./activityStreams";

/** Moving time left out at the start, while heart rate is still climbing to its steady level, in seconds. */
const SETTLING_TIME = 10 * 60;

/** The least moving time a run needs to have an Aerobic Decoupling, in seconds. */
const MIN_MOVING_TIME = 40 * 60;

/**
 * A run's Aerobic Decoupling as a percentage: how much its grade-adjusted speed per heartbeat falls from the first half
 * of its moving time to the second, after the first 10 minutes. Positive when it fell; it can be negative.
 * Stops and pauses in recording are not moving time; Walk Breaks are. Null with under 40 minutes of moving time, or
 * without a heart-rate or grade-adjusted speed stream.
 */
export function aerobicDecoupling(streams: ActivityStreams): number | null {
  const { heartrate, gradeAdjustedVelocity } = streams;
  if (heartrate === null || gradeAdjustedVelocity === null) return null;
  const seconds = movingSeconds(streams);
  const moving = seconds.reduce((sum, s) => sum + s, 0);
  if (moving < MIN_MOVING_TIME) return null;
  const middle = SETTLING_TIME + (moving - SETTLING_TIME) / 2;
  const halves = [new HalfAverages(), new HalfAverages()];
  let elapsed = 0;
  seconds.forEach((s, i) => {
    const start = elapsed;
    elapsed += s;
    // A sample straddling a boundary is shared between its sides by the time on each.
    halves[0]!.add(overlap(start, elapsed, SETTLING_TIME, middle), heartrate[i], gradeAdjustedVelocity[i]);
    halves[1]!.add(overlap(start, elapsed, middle, moving), heartrate[i], gradeAdjustedVelocity[i]);
  });
  const [first, second] = halves.map((h) => h.speedPerBeat());
  if (first == null || second == null || first === 0) return null;
  return (100 * (first - second)) / first;
}

/** Time-weighted average heart rate and grade-adjusted speed over one half, each over the samples that have it. */
class HalfAverages {
  private hrTime = 0;
  private hrSum = 0;
  private gapTime = 0;
  private gapSum = 0;

  /** Adds a sample covering `seconds` of this half; a heart rate or speed it lacks is left out of that average. */
  add(seconds: number, hr: number | null | undefined, gap: number | null | undefined): void {
    if (seconds <= 0) return;
    if (hr != null && hr > 0) {
      this.hrTime += seconds;
      this.hrSum += hr * seconds;
    }
    if (gap != null) {
      this.gapTime += seconds;
      this.gapSum += gap * seconds;
    }
  }

  /** Average grade-adjusted speed ÷ average heart rate; null without either. */
  speedPerBeat(): number | null {
    if (this.hrTime === 0 || this.gapTime === 0) return null;
    return this.gapSum / this.gapTime / (this.hrSum / this.hrTime);
  }
}

/** How long the stretch from `start` to `end` spends between `from` and `to`, in the same units. */
function overlap(start: number, end: number, from: number, to: number): number {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}
