# Shortfall Reasons are stored here, not written back to intervals.icu

Shortfall Reasons are the first data the runner authors rather than syncs, so they live in this app's own store, in a table sync never writes, keyed by the Planned Workout's intervals.icu event id. Writing them to intervals.icu instead was rejected: a WORKOUT event's description is parsed as the workout itself (an annotation could change what reaches the watch), the NSM app's plan pushes may overwrite event fields, Strava-imported Activities cannot be updated, and a Missed workout has no Activity to annotate.

## Consequences

- Reasons are invisible in intervals.icu and are not backed up with it; they live and die with this app's database.
- If the NSM app deletes and recreates a Planned Workout, its event id changes and the reason is orphaned: kept, but no longer shown. Re-keying (e.g. by date and name) is the fallback if that turns out to happen.
