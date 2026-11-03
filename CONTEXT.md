# NSM Performance Validator

Tracks a runner's progress on a Norwegian Singles Method (NSM) training plan by comparing completed runs against the recurring weekly sessions they were planned as.

## Language

### Plan

**Planned Workout**:
A workout scheduled on the calendar ahead of time (built in this app's planner, or earlier in the NSM app, and synced to the watch). It is the source of truth for what kind of run something was meant to be. Once its day has passed it is never changed.
_Avoid_: Scheduled run, plan item

**Week Plan**:
The runner's layout of one Training Week's workouts in this app: a Run Type, and a Quality Run Format or duration, for each day, or a rest day. It is a draft until pushed; once pushed, its workouts become Planned Workouts. A new Week Plan starts as a copy of the previous week's. Only the current Training Week's remaining days and next Training Week can be planned.
_Avoid_: Plan, schedule, template

**Plan Suggestion**:
A check the planner makes on a Week Plan from recent progress (pull back, easy discipline, volume step, Quality Share, threshold check). It is advice the runner may accept or dismiss; it never blocks a push.
_Avoid_: Recommendation, alert, rule

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
One timed work interval of a Quality Run, run at the planned heart-rate target (90–98% LTHR) and lasting about the Rep Length. Every such interval is a Rep, even beyond the planned rep count. Warm-up, cool-down, recoveries and short efforts such as strides are not Reps. A Rep may also be guided by a Rep Pace Target, but its heart-rate target stays its ceiling.
_Avoid_: Interval, lap, set

**Rep Pace Target**:
The pace a Quality Run's Reps are guided by on the watch, when the runner gives one: a plain pace (not GAP) per mile, sent as a band of ±5 s/mi around it. It is optional per Quality Run and only for Reps; every other step, and every Easy Run and Long Run, stays on heart rate. A new Quality Run starts with the last Rep Pace Target given for the same Rep Length. It only guides: missing it never changes whether a Quality Run is Complete or Over Target, or whether it counts toward progress.
_Avoid_: Target pace, threshold pace, Rep GAP (that is what was run)

**LTHR**:
The runner's lactate-threshold (LT2) heart rate, the anchor of every Quality Run's heart-rate target. It is read from the Planned Workouts rather than set separately: a Rep's target is 90–98% of LTHR, so LTHR follows the plan. New Planned Workouts take their LTHR from the runner's intervals.icu Run settings when they are planned, which are kept in step with the LTHR the runner's Garmin watch detects. The current LTHR is the one given by the most recent Quality Run's target, and it is the one every LT1 Pace and LT2 Pace is measured against, past weeks included. Training Load does not use it: it uses the recorded LTHR, the one intervals.icu recorded with each workout from that sport's settings at the time.
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
The runner's maximum heart rate, as recorded in intervals.icu; for running, kept in step with the runner's Garmin watch. It anchors the Easy HR Target. HR Load uses the recorded Max HR, the one intervals.icu recorded with each workout for its sport.
_Avoid_: Peak HR

**Easy HR Target**:
The planned heart-rate window of an Easy Run or Long Run, as a percentage of Max HR (e.g. 62–70%). It is read from the Planned Workouts, so it follows the plan; the current one is given by the most recent Easy Run or Long Run. The runner sets the one new Planned Workouts are given; it is the same for every Easy Run and Long Run in a Training Week.
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

**Cross-Training**:
A non-running workout recorded by the watch, such as a ride, a strength session or a hike. It adds to Training Load, and so to Fitness and Fatigue, but it is never an Activity: it cannot be Matched and never counts toward Weekly Volume or any other progress number.
_Avoid_: Other Activity, non-run, cross-train (as a noun)

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
The threshold pace in the runner's intervals.icu Run settings. It is shown only as a reference beside LT2 Pace, so the runner can see when that setting is out of date; it never feeds the estimate. Pace Load uses the one intervals.icu recorded with each run.

**Weekly Volume**:
Total running distance and time in a Training Week, across all Run Types. It is split into exactly two parts, Quality Volume and Easy Volume, because the NSM signal is how little of the week is run hard.
_Avoid_: Mileage, load

**Easy Volume**:
All of a Training Week's running that is not Quality Volume: Easy Runs, Long Runs, Unplanned Runs, Other Runs and every Quality Run's Quality Support.
_Avoid_: Easy miles, aerobic volume

**Quality Volume**:
The distance and time of a Quality Run's Reps: the running done at the Quality Run's heart-rate target. Only the Reps count; the rest of a Quality Run is Quality Support.
_Avoid_: Rep Volume, hard miles

**Quality Share / Easy Share**:
Quality Volume's and Easy Volume's moving time, each as a whole percentage of the Training Week's moving time; together they are NSM's intensity balance for the week. A week with no running has neither.
_Avoid_: Rep share, intensity ratio

**Planned Quality Share**:
The planned time of a Training Week's Reps as a whole percentage of the week's total planned time: Quality Share before the week is run.
_Avoid_: Quality Share (when the planned figure is meant)

**Quality Share Target**:
The Quality Share the runner aims for each Training Week (e.g. 25%). Planned Quality Share is checked against it; it never changes what counts toward progress.
_Avoid_: Quality ratio, intensity target

**Quality Support**:
The distance and time of a Quality Run that is not a Rep: its warm-up, cool-down and recoveries. It counts toward Easy Volume.
_Avoid_: Quality easy, junk miles

**Training Load**:
What one Activity or Cross-Training workout cost the body, worked out as the runner's intervals.icu Sport Settings say: a running Activity's Pace Load when it has a GAP, otherwise its HR Load; Cross-Training's HR Load. Each is a whole number, scored against the thresholds intervals.icu recorded with that workout for its sport, so a workout's Training Load never changes once recorded. A workout with neither, as without heart rate or without its recorded thresholds, has no Training Load and is shown as one without heart rate.
_Avoid_: Load (alone), TSS, stress score

**Pace Load**:
A running Activity's Training Load from its pace: moving time in hours × (its average GAP ÷ the intervals.icu Threshold Pace recorded with it)² × 100, so an hour at that pace is 100. GAP is intervals.icu's.
_Avoid_: rTSS, TSS

**HR Load**:
A workout's Training Load from its heart rate: Banister's TRIMP over its heart-rate samples, against the TRIMP of an hour at LTHR, which is 100 (intervals.icu's HRSS). LTHR, Max HR and resting HR are those intervals.icu recorded with the workout for its sport; resting HR is the runner's resting heart rate there. Samples without heart rate, and stopped ones when the workout records speed, add nothing.
_Avoid_: hrTSS, TRIMP (alone)

**Planned Training Load**:
A Planned Workout's estimated Training Load: its HR Load as if each step were run for its duration at the midpoint of its heart-rate target (a Rep's is its 90–98% LTHR, even when it has a Rep Pace Target), and a step without a target at the midpoint of the Easy HR Target, against the runner's current LTHR, Max HR and resting HR. Worked out here, never read from intervals.icu.
_Avoid_: Planned load, estimated TSS

**Fitness**:
The long-term average of daily Training Load, weighted toward recent days with a 42-day time constant: how much training the body has absorbed. Every Activity and Cross-Training workout counts except WeightTraining, which intervals.icu counts toward Fatigue only; a day without any adds nothing, so Fitness decays. Fitness and Fatigue start from intervals.icu's values on the day before stored history, kept locally; without them, from zero, and Fitness is settling for its first 42 days.
_Avoid_: CTL, chronic load, aerobic fitness (Easy Pace answers that)

**Fatigue**:
The short-term average of daily Training Load, with a 7-day time constant: how much recent training the body is still carrying.
_Avoid_: ATL, acute load, tiredness

**Form**:
Fitness minus Fatigue on the same day, that day's workouts included; today also counts the Planned Training Load of each of today's Planned Workouts not yet Matched. Negative while training is building; positive when rested. Progress is judged by how much of the time Form spends Optimal.
_Avoid_: TSB, freshness, readiness

**Form Zone**:
Where a day's Form, rounded, falls, named as intervals.icu names them: **Transition** +21 and above, **Fresh** +6 to +20, **Grey Zone** −9 to +5, **Optimal** −10 to −30, **High Risk** −31 and below. Optimal is where training builds Fitness without too much risk. The Grey Zone is a state of Form on a day, unrelated to a Grey Zone Run, and is always named alongside Form.
_Avoid_: green zone, grey zone (alone), TSB zone

**Training Week**:
Monday to Sunday, matching how the plan is laid out.

**Efficiency**:
Grade-adjusted speed per heartbeat across the Reps; a secondary progress number.
_Avoid_: Aerobic efficiency, EF
