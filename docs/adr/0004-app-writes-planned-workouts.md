# The app writes Planned Workouts to intervals.icu, in the NSM app's conventions

The app takes over plan building from the NSM app: the runner lays out a Week Plan here and pushes it to intervals.icu as WORKOUT events, which intervals.icu sends on to the Garmin watch. This ends ADR 0001's read-only use of intervals.icu. Pushed workouts copy the NSM app's conventions exactly (name format, `[NSM]` description tag, `workout_doc` step structure) and add an ownership marker of their own, so Matching, Run Type, LTHR and every progress number keep reading NSM-app history and our own workouts the same way. Storing Run Type and targets locally and dropping name parsing was rejected for now: it would need two analysis paths, one for the history and one for new workouts.

## Consequences

- A push only replaces events that carry our ownership marker, and never touches a Planned Workout whose day has passed. The exception is the first push of a Training Week, which, after confirmation, deletes the NSM-app workouts on that week's remaining days so Matching does not see two workouts on one day.
- Edits made on intervals.icu to an owned workout are overwritten by the next push; the app warns first.
- LTHR and Max HR for new workouts are read from the runner's intervals.icu Run settings. Garmin's auto-detected values do not reach intervals.icu, so the runner copies them over by hand.
- Pushing is kept behind one seam so a later Garmin Training API destination can replace intervals.icu without changing the planner.
