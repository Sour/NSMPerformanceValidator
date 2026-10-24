# NSM Performance Validator

Tracks a runner's progress on a Norwegian Singles Method (NSM) training plan by comparing completed runs against the recurring weekly sessions they were planned as.

## Language

### Plan

**Planned Workout**:
A workout scheduled on the calendar ahead of time (built in the NSM app and synced to the watch). It is the source of truth for what kind of run something was meant to be.
_Avoid_: Scheduled run, plan item

**Run Type**:
The category of a run, taken from its Planned Workout: Quality Run, Easy Run or Long Run.
_Avoid_: Session type, workout category

**Quality Run**:
A sub-threshold interval session: the hard sessions of an NSM week.
_Avoid_: Workout, hard day, threshold run, session

**Quality Run Format**:
The rep structure of a Quality Run, written as reps × rep duration (e.g. 2 × 10:00, 4 × 6:00, 7 × 3:00). It can change as the plan progresses.
_Avoid_: Workout type, session

**Rep Length**:
The planned duration of one Rep (e.g. 10:00, 6:00, 3:00). Progress is only ever compared between Quality Runs with the same Rep Length, regardless of rep count or recovery.
_Avoid_: Format (when only the duration is meant)

**Rep**:
One timed work interval of a Quality Run, run at the planned heart-rate target (90–98% LTHR). Warm-up, cool-down and recoveries are not Reps.
_Avoid_: Interval, lap, set

**LTHR**:
The runner's lactate-threshold (LT2) heart rate, the anchor of every Quality Run's heart-rate target. It is read from the Planned Workouts rather than set separately: a Rep's target is 90–98% of LTHR, so LTHR follows the plan whenever the runner changes it in the NSM app. The current LTHR is the one given by the most recent Quality Run's target, and it is the one every LT1 Pace and LT2 Pace is measured against, past weeks included.
_Avoid_: LT2 HR, threshold HR, max HR

**LT1 HR**:
The runner's first (aerobic) lactate-threshold heart rate. Unless the runner sets it, for example from a test, it is assumed to be a fixed fraction of LTHR, and an assumed LT1 HR is always shown as assumed.
_Avoid_: Aerobic threshold, easy ceiling

**Complete / Incomplete**:
A Quality Run is Complete when every planned Rep was run; otherwise it is Incomplete. Only Complete Quality Runs count toward progress; Incomplete ones are shown but not trended.
_Avoid_: Valid, partial, failed


**Over Target**:
A Quality Run in which at least one Rep's average heart rate exceeded the top of the planned heart-rate target. It still counts toward progress but is flagged, because its pace overstates fitness.
_Avoid_: Too hard, red zone

**Easy Run**:
A low-intensity continuous run between Quality Runs.
_Avoid_: Recovery run, jog

**Long Run**:
The week's longest continuous easy-paced run.

### Execution

**Activity**:
A run that was actually recorded by the watch.
_Avoid_: Workout, session, run (when the recorded thing is meant)

**Match**:
The link between an Activity and the Planned Workout it fulfilled: either intervals.icu's own pairing or, failing that, the Planned Workout on the same day. Only running Activities (intervals.icu types Run, TrailRun and VirtualRun) can be Matched.
_Avoid_: Pairing (that is intervals.icu's mechanism, one way a Match is made)

**Unplanned Run**:
A running Activity with no Match. It counts toward Weekly Volume but has no Run Type.
_Avoid_: Extra run, bonus run

**Missed**:
A past Planned Workout with no Matched Activity.
_Avoid_: Skipped

**Shortfall Reason**:
The runner's account of why a Planned Workout fell short: it was Missed (any Run Type), or its Matched Quality Run was Incomplete. A category from a fixed list plus an optional free-text note. It only annotates; it never changes whether a run counts toward progress, and it is shown only while the workout is still Missed or Incomplete.
_Avoid_: Excuse, Incomplete Reason, Missed Reason, note (when the category is meant)

### Progress

**Rep GAP**:
The average grade-adjusted pace across a Quality Run's Reps. The headline progress number.
_Avoid_: Pace, speed (when GAP is meant)

**Rep HR**:
The average heart rate across a Quality Run's Reps, shown alongside Rep GAP to reveal what a pace change cost.

**Easy GAP / Easy HR**:
Grade-adjusted pace and average heart rate of an Easy Run or Long Run, tracked over time as a slow-moving aerobic fitness signal.

**LT1 Pace / LT2 Pace**:
The estimated grade-adjusted pace at which the runner's heart rate would sit at LT1 HR or LTHR. Both are read from a single pace-versus-heart-rate line fitted to the Rep GAP / Rep HR of Complete Quality Runs and the Easy GAP / Easy HR of Easy Runs and Long Runs over the last six Training Weeks. Over Target Quality Runs are included; Incomplete ones and Unplanned Runs are not.
_Avoid_: Threshold pace (it does not say which threshold), race pace

**intervals.icu Threshold Pace**:
The threshold pace in the runner's intervals.icu Run settings. It is shown only as a reference beside LT2 Pace, so the runner can see when that setting is out of date; it never feeds the estimate.

**Weekly Volume**:
Total running distance and time in a Training Week, across all Run Types.
_Avoid_: Mileage, load

**Training Week**:
Monday to Sunday, matching how the plan is laid out.

**Efficiency**:
Grade-adjusted speed per heartbeat across the Reps; a secondary progress number.
_Avoid_: Aerobic efficiency, EF
