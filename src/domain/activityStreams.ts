/** An Activity's samples over time, one entry per sample in each stream. */
export interface ActivityStreams {
  /** Seconds since the start of the Activity. */
  time: number[];
  /** Heart rate in bpm; null when not recorded. */
  heartrate: (number | null)[] | null;
  /** Cadence per foot, as intervals.icu gives it (80 is 160 steps/min); null when not recorded. */
  cadence: (number | null)[] | null;
}

/** Below 130 steps/min, 65 per foot, the runner is walking. */
const WALKING_CADENCE = 65;

/** The shortest stretch below the walking cadence that is a Walk Break, in seconds. */
const MIN_WALK_BREAK = 15;

/** A longer gap between samples is a pause in recording, which is not moving time. */
const MAX_SAMPLE_GAP = 10;

/** The seconds walked in Walk Breaks; null without a cadence stream. */
export function walkBreakTime(streams: ActivityStreams): number | null {
  const cadence = streams.cadence;
  if (cadence === null) return null;
  let total = 0;
  let stretch = 0;
  const seconds = sampleSeconds(streams);
  for (let i = 0; i <= cadence.length; i++) {
    const c = cadence[i];
    // A pause in recording covers no time and ends a stretch, as a full stop does.
    if (i < cadence.length && c != null && c > 0 && c < WALKING_CADENCE && seconds[i]! > 0) {
      stretch += seconds[i]!;
      continue;
    }
    if (stretch >= MIN_WALK_BREAK) total += stretch;
    stretch = 0;
  }
  return total;
}

/**
 * The share of moving time spent above `bpm`, from the first minute and with walking in;
 * null without a heart-rate stream or moving time.
 */
export function shareAbove(streams: ActivityStreams, bpm: number): number | null {
  const hr = streams.heartrate;
  if (hr === null) return null;
  const seconds = sampleSeconds(streams);
  const moving = seconds.reduce((sum, s) => sum + s, 0);
  if (moving === 0) return null;
  const above = seconds.reduce((sum, s, i) => sum + (hr[i] != null && hr[i]! > bpm ? s : 0), 0);
  return above / moving;
}

/**
 * How long each sample covers: the time since the one before, or for the first sample the time to the next.
 * A sample after a pause in recording covers nothing; neither does a full stop (cadence 0), which is not moving time.
 */
function sampleSeconds({ time, cadence }: ActivityStreams): number[] {
  return time.map((t, i) => {
    const gap = i === 0 ? (time[1] ?? t) - t : t - time[i - 1]!;
    const stopped = cadence !== null && cadence[i] === 0;
    return gap > MAX_SAMPLE_GAP || stopped ? 0 : gap;
  });
}
