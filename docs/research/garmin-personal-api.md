# Can Garmin's Personal API replace intervals.icu?

Research for #45, done on 2026-11-02 by calling the API live with the runner's own Personal API key, and from Garmin's published docs.

**Answer: no.** The Personal tier is read-only, so a Week Plan cannot reach the watch without intervals.icu. It does, however, expose the watch's auto-detected running LTHR and Max HR, which ends the hand-copying described in ADR 0004. See [ADR 0007](../adr/0007-running-thresholds-from-garmin.md) for what was decided.

## How access works

- The runner creates a Personal API key at `connect.garmin.com/app/settings/personalApiToken`, accepting Garmin's terms. The key is shown once and expires after 30, 90, 180 or 365 days, chosen at creation; Garmin emails about a week before. The key's expiry cannot be read from the key itself.
- `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>` returns a bare JWT access token (not JSON). It lasts 24 hours or until the key expires; there are no refresh tokens, so a new one is minted from the key.
- Data calls go to `https://personal.connectapi.garmin.com` with `Authorization: Bearer <token>`.

## 1. Training API (structured workouts, calendar)?

**No.** The token's scopes are `CONNECT_READ`, `PERSONAL_API_FITNESS_READ`, `PERSONAL_API_NUTRITION_READ`, `PERSONAL_API_USER_READ` and `PERSONAL_API_WELLNESS_READ`: nothing writes. The Personal OpenAPI spec has 26 operations, every one a `GET`. Garmin's overview lists the Training API only under **Starter** and **Enterprise**, both business tiers:

| Tier | Training API | Delivery | History | Access |
|---|---|---|---|---|
| Personal | No | Pull | Yes (back to 2025-05-18 for this runner) | Self-service key |
| Starter | Yes | Push only (webhooks to a public URL) | Not included | Business application form |
| Enterprise | Yes | Push or ping/pull | 1 month or more | Request after Starter; commercial terms |

## 2. LTHR, LT pace, Max HR, resting HR?

- **Current values, per sport:** `GET /biometric-service/heartRateZones/v2` returns LTHR, Max HR and resting HR for `DEFAULT`, `RUNNING`, `CYCLING` and `SWIMMING`. Only `RUNNING` uses the `LACTATE_THRESHOLD` method (the watch's auto-detection); the others use `HR_RESERVE`, so their LTHR is a setting, not a measurement. On 2026-11-02: running LTHR 173, Max HR 194, resting HR 51 (auto-updating).
- **Per workout:** every Activity's FIT file records them in documented messages: `zones_target.threshold_heart_rate` (173), `zones_target.max_heart_rate` (194) and `user_profile.resting_heart_rate` (51).
- **LT pace: not available.** `lactateThresholdSpeed` exists in the activity schemas but was null on all 477 Activities in the runner's history, and no endpoint returns it.
- **Resting HR already reaches intervals.icu** through its daily Garmin wellness sync, and intervals.icu records the day's value with each workout (`icu_resting_hr` equalled wellness `restingHR` on every day checked). It needs no new sync.

## 3. Full FIT files with step laps and altitude?

**Yes.** `GET /download-service/files/activity/{id}` returns the watch's original FIT file, zipped. In a 2 × 10:00 Quality Run:

- Laps carry `wkt_step_index`, so Reps can be found from the workout's steps. A Rep can span several laps: each 10:00 Rep was split by a distance auto-lap (481 s + 119 s), so laps of the same step must be joined.
- `record` messages have 1-second `enhanced_altitude`, `enhanced_speed`, `heart_rate`, `cadence` and position, enough to compute GAP.
- The planned workout is embedded (`workout`, `workout_step`), and `GET /activity-service/activity/{id}/workouts` returns it as JSON with heart-rate targets per step.
- Activity summaries include Garmin's own `avgGradeAdjustedSpeed` (286 of 291 runs) and `activityTrainingLoad`.

## 4. Terms, rate limits, approval, cost

Self-service, no approval for Personal; the terms are accepted when creating the key. Rate limits and costs are not published; six back-to-back calls were not throttled.

## What intervals.icu does that would have to be replaced

| intervals.icu does | From Garmin Personal |
|---|---|
| Pushing Planned Workouts to the watch | **Lost.** No write access on Personal. |
| Rep detection | Computable: FIT laps by `wkt_step_index`, joining split laps. |
| Activity ↔ Planned Workout pairing | Computable: the executed workout is embedded in each Activity. |
| GAP, which feeds Pace Load | Provided per Activity (`avgGradeAdjustedSpeed`); per-second GAP computable from altitude and speed. Would not match intervals.icu's GAP exactly. |
| History backfill | Provided: the activity list pages back to the first recorded Activity. |
| Recorded LTHR and Max HR per workout | Provided in each FIT file (`zones_target`). |
| Recorded resting HR per workout | Provided in each FIT file (`user_profile`). |
| Recorded Threshold Pace per workout | **Lost.** Garmin has no LT pace through this API. |
| Fitness and Fatigue starting point | **Lost** as intervals.icu's values; Garmin's own `activityTrainingLoad` is a different model. Stored locally already (ADR 0006), so only new history would need one. |

## Recommendation

Do not open an ADR replacing ADR 0001: the move is blocked by the missing Training API, and Starter's business application, public webhook and lack of history are out of proportion for one runner. Revisit if Garmin adds the Training API or a write scope to the Personal tier.

## Sources

- [Garmin Connect Developer Program overview](https://developer.garmin.com/gc-developer-program/overview)
- [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api)
- [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [Personal API Swagger docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [intervals.icu API docs](https://intervals.icu/api/v1/docs) (`PUT /api/v1/athlete/{athleteId}/sport-settings/{id}`)
