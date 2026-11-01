# Training Load, Fitness, Fatigue and Form are computed here, not read from intervals.icu

intervals.icu already works out a daily `ctl` / `atl` and a per-activity `icu_training_load`, and reading them would replicate its fitness graph exactly. We compute our own instead, because the runner means to leave intervals.icu (see the Garmin research in #45), and numbers it computes would vanish with it. Training Load is an LTHR-anchored heart-rate load (an hour at LTHR is 100), built only from heart-rate samples and LTHR, which any future data source will provide; Fitness, Fatigue and Form follow intervals.icu's model (42-day and 7-day exponentially weighted averages, Form the same-day difference) so the two graphs can be checked against each other while both exist.

## Consequences

- The graph will not match intervals.icu's exactly: its load can use power or pace and sport-specific thresholds, ours never does.
- Every sport counts, so Cross-Training is synced for the first time, and heart-rate streams are fetched for every Activity and Cross-Training workout, not just Easy Runs and Long Runs.
- Every sport is measured against the running LTHR in effect on the day, so rides read slightly low and a workout's Training Load never changes once recorded.
- A workout without heart rate adds nothing to Fitness or Fatigue; the graph shows it rather than estimating one.
- Fitness starts from zero at the start of stored history and is not trustworthy for its first 42 days.
