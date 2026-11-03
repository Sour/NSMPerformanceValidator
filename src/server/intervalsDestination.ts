import { localDate } from "../domain/localDate";
import { formatDuration } from "../domain/pace";
import { repHrTarget } from "../domain/thresholdPace";
import type { WorkoutDay } from "../domain/weekPlan";
import {
  eventVersion,
  isNsmEvent,
  isOwnedEvent,
  NSM_TAG,
  ownedExternalId,
  type IntervalsClient,
  type IntervalsEvent,
} from "./intervals";
import type { DayPushResult, NsmAppWorkout, PlanDestination, WorkoutTargets } from "./planDestination";

/**
 * Pushes Week Plans to intervals.icu as WORKOUT events in the NSM app's conventions, which intervals.icu sends on to the
 * watch. It stops at the first error; pushing again finds this app's workouts by their ownership marker, so it finishes
 * the job without duplicating any.
 */
export function createIntervalsDestination(client: IntervalsClient): PlanDestination {
  return {
    async push({ days, targets, replaceNsmApp }) {
      const results: DayPushResult[] = [];
      try {
        const payloads = days.map(({ date, day }) => (day.kind === "Rest" ? null : workoutEvent(date, day, targets)));
        const dates = days.map((d) => d.date).sort();
        if (dates.length === 0) return { outcome: "Pushed", days: [], replaced: [] };
        const onDays = (await client.events(dates[0]!, dates.at(-1)!)).filter((e) => dates.includes(localDate(e.start_date_local)));
        const nsmApp: NsmAppWorkout[] = onDays
          .filter((e) => isNsmEvent(e) && !isOwnedEvent(e))
          .map((e) => ({ id: String(e.id), date: localDate(e.start_date_local), name: e.name }));
        if (nsmApp.length > 0 && !replaceNsmApp) return { outcome: "ConfirmReplace", nsmAppWorkouts: nsmApp };

        for (const [i, { date }] of days.entries()) {
          // A day's NSM-app workouts go just before its own is written, so a push that stops leaves no day empty.
          for (const w of nsmApp.filter((w) => w.date === date)) await client.deleteEvent(Number(w.id));
          const [keep, ...extra] = onDays.filter((e) => isOwnedEvent(e) && localDate(e.start_date_local) === date);
          const payload = payloads[i];
          let saved: IntervalsEvent | null = null;
          if (payload) saved = keep ? await client.updateEvent(keep.id, payload) : await client.createEvent(payload);
          for (const e of payload ? extra : [keep, ...extra]) if (e) await client.deleteEvent(e.id);
          results.push({ date, eventId: saved && String(saved.id), version: saved && eventVersion(saved) });
        }
        return { outcome: "Pushed", days: results, replaced: nsmApp };
      } catch (e) {
        return { outcome: "Failed", days: results, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

/** The intervals.icu calendar event this app creates or updates for one Week Plan day. */
export interface WorkoutEventPayload {
  category: "WORKOUT";
  type: "Run";
  start_date_local: string;
  name: string;
  /** The workout as intervals.icu workout text, which it builds `workout_doc` from, tagged [NSM]. */
  description: string;
  /** This app's ownership marker. */
  external_id: string;
}

/** A Rep's heart-rate target is 90–98% of LTHR, which its step gives as a percentage. */
const REP_TARGET_PERCENT = "90-98% LTHR hr=1s";
/** A Rep Pace Target is sent as a band this many seconds per mile either side of it. */
const REP_PACE_BAND = 5;

/** The NSM app plans each workout at midday. */
const START_TIME = "T12:00:00";

/**
 * The event for a Week Plan day on `date`, in the NSM app's conventions exactly: the Quality Run Format and its bpm
 * target in the name, or "Easy Run" / "Long Run"; its steps as workout text tagged [NSM]; easy steps at the Easy HR Target
 * as a percentage of Max HR, Reps at 90–98% of LTHR. The one departure: a Quality Run with a Rep Pace Target guides its
 * Reps by a pace band around it instead (ADR 0004), and its name still carries the bpm target.
 */
export function workoutEvent(date: string, day: WorkoutDay, { lthr, easyHrTarget }: WorkoutTargets): WorkoutEventPayload {
  const easy = `${easyHrTarget.low}-${easyHrTarget.high}% HR hr=1s`;
  let name: string;
  let steps: string;
  if (day.kind === "Quality Run") {
    if (lthr === null) throw new Error("No LTHR in the intervals.icu Run settings, so Quality Runs have no heart-rate target");
    const bpm = repHrTarget(lthr);
    name = `${day.reps} x ${formatDuration(day.repLength)} at ${bpm.low}–${bpm.high} bpm`;
    const block = [
      `${day.reps}x`,
      `- ${durationText(day.repLength)} ${day.repPaceTarget === undefined ? REP_TARGET_PERCENT : paceBandText(day.repPaceTarget)} intensity=active`,
      ...(day.recovery > 0 ? [`- ${durationText(day.recovery)} intensity=recovery`] : []),
    ].join("\n");
    steps = [
      ...(day.warmUp > 0 ? [`- ${durationText(day.warmUp)} ${easy} intensity=warmup press lap`] : []),
      block,
      ...(day.coolDown > 0 ? [`- ${durationText(day.coolDown)} ${easy} intensity=cooldown press lap`] : []),
    ].join("\n\n");
  } else {
    name = day.kind;
    steps = `- ${durationText(day.duration)} ${easy}`;
  }
  return {
    category: "WORKOUT",
    type: "Run",
    start_date_local: `${date}${START_TIME}`,
    name,
    description: `${steps}\n${NSM_TAG}`,
    external_id: ownedExternalId(date),
  };
}

/** A Rep Pace Target in seconds per mile as an intervals.icu pace band, e.g. 420 as "6:55/mi-7:05/mi Pace". */
function paceBandText(secondsPerMile: number): string {
  return `${formatDuration(secondsPerMile - REP_PACE_BAND)}/mi-${formatDuration(secondsPerMile + REP_PACE_BAND)}/mi Pace`;
}

/** Seconds as intervals.icu workout text writes a duration: "10m", "45s" or "1m30s". */
function durationText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m > 0 ? `${m}m` : ""}${s > 0 || m === 0 ? `${s}s` : ""}`;
}
