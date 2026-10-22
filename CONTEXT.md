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
The link between an Activity and the Planned Workout it fulfilled: either intervals.icu's own pairing or, failing that, the Planned Workout on the same day. Only Activities of type Run can be Matched.
_Avoid_: Pairing (that is intervals.icu's mechanism, one way a Match is made)

**Unplanned Run**:
A running Activity with no Match. It counts toward Weekly Volume but has no Run Type.
_Avoid_: Extra run, bonus run

**Missed**:
A past Planned Workout with no Matched Activity.
_Avoid_: Skipped

### Progress

**Rep GAP**:
The average grade-adjusted pace across a Quality Run's Reps. The headline progress number.
_Avoid_: Pace, speed (when GAP is meant)

**Rep HR**:
The average heart rate across a Quality Run's Reps, shown alongside Rep GAP to reveal what a pace change cost.

**Easy GAP / Easy HR**:
Grade-adjusted pace and average heart rate of an Easy Run or Long Run, tracked over time as a slow-moving aerobic fitness signal.

**Weekly Volume**:
Total running distance and time in a Training Week, across all Run Types.
_Avoid_: Mileage, load

**Training Week**:
Monday to Sunday, matching how the plan is laid out.

**Efficiency**:
Grade-adjusted speed per heartbeat across the Reps; a secondary progress number.
_Avoid_: Aerobic efficiency, EF
