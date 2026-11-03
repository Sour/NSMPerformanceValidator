# Running thresholds come from Garmin, written into intervals.icu

The runner's Garmin watch auto-detects LTHR, but it never reached intervals.icu, so the runner copied it and Max HR over by hand (ADR 0004). Garmin's Personal API exposes them (see [the research](../research/garmin-personal-api.md)), so on each sync the app reads the watch's running LTHR and Max HR and, when they differ, writes them into the runner's intervals.icu Run Sport Settings. Everything downstream is unchanged: new Planned Workouts take their LTHR from those settings, and intervals.icu records them with each run for Training Load (ADR 0006).

Garmin is read only for these two numbers; intervals.icu stays the data source (ADR 0001). Reading Activities from Garmin as well was rejected because it means two sync paths and our own Rep detection and Matching, for no gain while plans must still be pushed through intervals.icu. Leaving intervals.icu altogether is shelved, not abandoned: the Personal tier has no Training API or write scope, and the Starter tier needs a business application, a public webhook and has no history. Revisit if Garmin adds training to the Personal tier; until then ADR 0004's push seam and ADR 0005's locally computed Training Load stay as they are.

## Consequences

- Only running is synced, because only Garmin's running profile uses the watch's lactate-threshold detection; its cycling, swimming and default LTHRs are settings. Ride, Swim and Other Sport Settings stay as the runner sets them in intervals.icu.
- Resting HR is not synced: intervals.icu already takes the watch's daily resting HR from its Garmin wellness sync and records it with each workout.
- Threshold Pace is not synced: Garmin does not expose LT pace through this API.
- A change is written without asking, and shown after the fact, because the values are the watch's measurements and confirming them would only replace copying with clicking. A new LTHR moves every Rep's heart-rate target from the next push, and Training Load from the next run.
- A Garmin failure (an expired or revoked key, or Garmin down) never stops a sync; it leaves the thresholds as they are and is shown until a sync succeeds. Personal API keys expire after at most a year.
