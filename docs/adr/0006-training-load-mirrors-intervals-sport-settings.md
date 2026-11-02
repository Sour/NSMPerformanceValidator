# Training Load mirrors the athlete's intervals.icu Sport Settings, and Fitness starts from intervals.icu's

Supersedes ADR 0005's Training Load decision. Our Fitness graph disagreed badly with intervals.icu's (22.5 / 39.2 against 34.9 / 36.7 on 2026-11-01), so neither could be trusted while both exist. Feeding intervals.icu's daily loads through our averages reproduced its Fitness exactly, so every difference came from what went in. Training Load is now worked out exactly as the runner's intervals.icu Sport Settings say (Training Load Priority: Pace, then HR): a running Activity scores Pace Load (moving time × (GAP ÷ Threshold Pace)²) and otherwise HR Load (HRSS, Banister's TRIMP per sample normalised to an hour at LTHR); Cross-Training scores HR Load. Each is scored against the LTHR, Max HR, resting HR and intervals.icu Threshold Pace recorded with that workout, which already differ per sport, and rounded to a whole number as intervals.icu does. Fitness and Fatigue start from intervals.icu's values on the day before stored history, fetched once and kept locally.

ADR 0005's reasoning still holds: the numbers are computed here from inputs stored locally (each workout's raw response and streams, and the starting point), so they survive leaving intervals.icu. Reading `icu_training_load` or the daily `ctl` / `atl` was rejected again for that reason; they serve only as test oracles.

## Consequences

- Both formulas were checked against the runner's 42 workouts from 2026-09-29 to 2026-11-01 and matched intervals.icu within its rounding, and Fatigue then matched intervals.icu's every day. Fitness did not quite: intervals.icu leaves WeightTraining out of Fitness (it counts toward Fatigue only), while every workout counts toward ours.
- Streams are fetched with speed (`velocity_smooth`) so stopped time can be left out of HR Load; streams stored without it were re-fetched once.
- Training Load no longer depends on Quality Run targets, so the graph draws without a Quality Run naming one. A workout without its recorded thresholds has no Training Load.
- Pace Load uses intervals.icu's GAP. Replacing it, and the recorded thresholds, when leaving intervals.icu belongs with the Garmin research (#45).
- With a starting point stored, no day is settling. Without one (the request failed or intervals.icu had none), Fitness starts from zero and settles for 42 days, as before. If stored history comes to start earlier, a starting point for the new day is fetched; one is never otherwise replaced.
- Cross-Training from before it was synced is fetched once over the whole stored range.
- Power Load is not used for any sport.
