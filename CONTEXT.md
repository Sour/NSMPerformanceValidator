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
One timed work interval of a Quality Run, run at the planned heart-rate target (90–98% LTHR) and lasting about the Rep Length. Every such interval is a Rep, even beyond the planned rep count. Warm-up, cool-down, recoveries and short efforts such as strides are not Reps.
_Avoid_: Interval, lap, set

**LTHR**:
The runner's lactate-threshold (LT2) heart rate, the anchor of every Quality Run's heart-rate target. It is read from the Planned Workouts rather than set separately: a Rep's target is 90–98% of LTHR, so LTHR follows the plan whenever the runner changes it in the NSM app. The current LTHR is the one given by the most recent Quality Run's target, and it is the one every LT1 Pace and LT2 Pace is measured against, past weeks included.
_Avoid_: LT2 HR, threshold HR, max HR

**LT1 HR**:
The runner's first (aerobic) lactate-threshold heart rate. Unless the runner sets it, for example from a test, it is assumed to be a fixed fraction of LTHR, and an assumed LT1 HR is always shown as assumed.
_Avoid_: Aerobic threshold, easy ceiling

**Complete / Incomplete**:
A Quality Run is Complete when at least the planned number of Reps was run; otherwise it is Incomplete. Only Complete Quality Runs count toward progress; Incomplete ones are shown but not trended.
_Avoid_: Valid, partial, failed

**Over Target**:
A Quality Run in which at least one Rep's average heart rate exceeded the top of the planned heart-rate target, or an Easy Run or Long Run that spent more than 10% of its moving time above the top of its Easy HR Target. It still counts toward progress but is flagged, because its pace overstates fitness.
_Avoid_: Too hard, red zone

**Max HR**:
The runner's maximum heart rate, as recorded in intervals.icu. It anchors the Easy HR Target.
_Avoid_: Peak HR

**Easy HR Target**:
The planned heart-rate window of an Easy Run or Long Run, as a percentage of Max HR (e.g. 62–70%). It is read from the Planned Workouts, so it follows the plan; the current one is given by the most recent Easy Run or Long Run.
_Avoid_: Easy zone, Z1, easy ceiling

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

**Grey Zone Run**:
An Easy Run or Long Run that spent more than 25% of its moving time above the top of its Easy HR Target: too hard to be easy, too easy to be quality, so it does little for fitness. It is shown but does not count toward Easy Pace progress.
_Avoid_: Not Easy, too hard, junk run

**Walk Break**:
A stretch of an Easy Run or Long Run walked rather than run: cadence below a walking threshold for at least 15 seconds. Walk Breaks are fine; they are tracked so the runner can see them fade as aerobic fitness improves, and they never stop a run counting toward progress.
_Avoid_: Stop, pause (a stop is excluded from moving time; a walk is not)

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

**Easy Pace**:
An Easy Run's or Long Run's Easy GAP scaled to the middle of the current Easy HR Target, assuming grade-adjusted speed rises in proportion to heart rate. Walk Breaks stay in, since needing to walk is part of the runner's fitness. It answers "am I getting faster at the same easy effort", one value per run; the headline easy progress number.
_Avoid_: Normalised pace, Easy GAP (when the scaled number is meant), aerobic pace

**LT1 Pace / LT2 Pace**:
The estimated grade-adjusted pace at which the runner's heart rate would sit at LT1 HR or LTHR. Both are read from a single pace-versus-heart-rate line fitted to the Rep GAP / Rep HR of Complete Quality Runs and the Easy GAP / Easy HR of Easy Runs and Long Runs over the last six Training Weeks. Over Target Quality Runs are included; Incomplete ones and Unplanned Runs are not.
_Avoid_: Threshold pace (it does not say which threshold), race pace

**Not enough data**:
What LT1 Pace and LT2 Pace show for a Training Week whose recent runs cannot support an estimate: too few Complete Quality Runs, too few Easy Runs and Long Runs, or pace that does not get faster as heart rate rises.
_Avoid_: No data, unknown

**intervals.icu Threshold Pace**:
The threshold pace in the runner's intervals.icu Run settings. It is shown only as a reference beside LT2 Pace, so the runner can see when that setting is out of date; it never feeds the estimate.

**Weekly Volume**:
Total running distance and time in a Training Week, across all Run Types. It is broken down by Run Type, except that a Quality Run contributes two parts: its Rep Volume and its Quality Support.
_Avoid_: Mileage, load

**Rep Volume**:
The distance and time of a Quality Run's Reps: the running done at the Quality Run's heart-rate target.
_Avoid_: Quality volume, hard miles

**Quality Support**:
The distance and time of a Quality Run that is not a Rep: its warm-up, cool-down and recoveries.
_Avoid_: Quality easy, junk miles

**Training Week**:
Monday to Sunday, matching how the plan is laid out.

**Efficiency**:
Grade-adjusted speed per heartbeat across the Reps; a secondary progress number.
_Avoid_: Aerobic efficiency, EF

**Easy Efficiency**:
Grade-adjusted speed per heartbeat over a whole Easy Run or Long Run: Easy GAP divided by Easy HR. Tracked over time beside Easy GAP / Easy HR as an aerobic fitness signal.
_Avoid_: Efficiency (when the Quality Run number is not meant), EF
