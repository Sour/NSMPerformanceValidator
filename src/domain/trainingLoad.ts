import { recordedSeconds, type ActivityStreams } from "./activityStreams";

/** An hour at LTHR is 100. */
const TRAINING_LOAD_PER_HOUR_AT_LTHR = 100;

/**
 * The Training Load of an Activity or Cross-Training workout from its heart rate against `lthr`, the LTHR in effect on
 * its day. Each second counts (HR / LTHR)² of a second at LTHR, the hrTSS formulation: an hour at LTHR is 100, an hour
 * at 80% of LTHR 64. Samples without heart rate, and pauses in recording, add nothing. Null when it has no heart rate
 * at all.
 */
export function trainingLoad(streams: Pick<ActivityStreams, "time" | "heartrate"> | null, lthr: number): number | null {
  const hr = streams?.heartrate;
  if (!streams || !hr || !hr.some(hasHeartRate)) return null;
  const seconds = recordedSeconds(streams.time);
  const secondsAtLthr = seconds.reduce((sum, s, i) => {
    const bpm = hr[i];
    return hasHeartRate(bpm) ? sum + s * (bpm / lthr) ** 2 : sum;
  }, 0);
  return (secondsAtLthr / 3600) * TRAINING_LOAD_PER_HOUR_AT_LTHR;
}

/** A heart rate of 0 is a dropped sensor, not a recorded heart rate. */
function hasHeartRate(bpm: number | null | undefined): bpm is number {
  return bpm != null && bpm > 0;
}
