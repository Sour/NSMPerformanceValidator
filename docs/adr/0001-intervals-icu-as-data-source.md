# intervals.icu, not Garmin Connect, is the data source

Runs are recorded on a Garmin watch, but the app reads everything from the intervals.icu API rather than from Garmin. intervals.icu has an official API with a personal API key, whereas Garmin access would mean the unofficial `garminconnect` login or a business-only developer program. It also already holds the NSM Planned Workouts, pairs Activities with them, and detects the Reps inside each Activity, which is most of the analysis.

## Consequences

- Garmin must sync to intervals.icu directly. Activities that arrive through Strava are not readable via the intervals.icu API.
- Rep detection is intervals.icu's, not ours. We store its raw responses so metrics can be recomputed when our matching rules change.
