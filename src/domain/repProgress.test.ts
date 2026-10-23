import { describe, expect, it } from "vitest";
import type { DetectedInterval } from "./qualityRun";
import { repLengthCards, type AnalysedActivity, type AnalysedPlannedWorkout } from "./repProgress";

function planned(id: number, date: string, name: string, recovery: number | null = 90): AnalysedPlannedWorkout {
  return { id, date, name, pairedActivityId: `a${id}`, recovery };
}

function activity(id: number, date: string, intervals: DetectedInterval[] | null): AnalysedActivity {
  return { id: `a${id}`, date, type: "Run", name: "Everett Running", movingTime: 3600, pairedEventId: id, intervals };
}

function work(movingTime: number, gap: number, averageHeartrate = 165): DetectedInterval {
  return { type: "WORK", movingTime, gap, averageHeartrate };
}

describe("repLengthCards", () => {
  it("groups Quality Runs by Rep Length, not exact Format, longest Rep Length first", () => {
    const cards = repLengthCards(
      [
        planned(1, "2026-10-05", "2 x 10:00 at 163–177 bpm"),
        planned(2, "2026-10-07", "4 x 6:00 at 163–177 bpm"),
        planned(3, "2026-10-14", "5 x 6:00 at 163–177 bpm"),
        planned(4, "2026-10-15", "Easy Run"),
      ],
      [
        activity(1, "2026-10-05", [work(600, 3.1), work(600, 3.1)]),
        activity(2, "2026-10-07", Array.from({ length: 4 }, () => work(360, 3.2))),
        activity(3, "2026-10-14", Array.from({ length: 5 }, () => work(360, 3.3))),
        activity(4, "2026-10-15", []),
      ],
    );
    expect(cards.map((c) => [c.repLength, c.runs.map((s) => s.date)])).toEqual([
      [600, ["2026-10-05"]],
      [360, ["2026-10-07", "2026-10-14"]],
    ]);
  });

  it("has a card for a Rep Length that has not been run yet", () => {
    const cards = repLengthCards([planned(1, "2026-10-30", "7 x 3:00 at 163–177 bpm")], []);
    expect(cards).toEqual([{ repLength: 180, runs: [], latest: null, previous: null }]);
  });

  it("takes the latest and previous Rep GAP from Complete runs only", () => {
    const cards = repLengthCards(
      [
        planned(1, "2026-09-30", "4 x 6:00"),
        planned(2, "2026-10-07", "4 x 6:00"),
        planned(3, "2026-10-14", "4 x 6:00"),
        planned(4, "2026-10-21", "4 x 6:00"),
      ],
      [
        activity(1, "2026-09-30", [work(112, 2.5), work(228, 2.3)]),
        activity(2, "2026-10-07", Array.from({ length: 4 }, () => work(360, 3.1))),
        activity(3, "2026-10-14", Array.from({ length: 3 }, () => work(360, 3.4))),
        activity(4, "2026-10-21", Array.from({ length: 4 }, () => work(360, 3.25))),
      ],
    );
    const card = cards[0]!;
    expect(card.runs.map((s) => [s.date, s.complete, s.repsRun])).toEqual([
      ["2026-09-30", false, 0],
      ["2026-10-07", true, 4],
      ["2026-10-14", false, 3],
      ["2026-10-21", true, 4],
    ]);
    expect(card.latest).toMatchObject({ date: "2026-10-21", repGap: 3.25 });
    expect(card.previous).toMatchObject({ date: "2026-10-07", repGap: 3.1 });
  });

  it("skips a Complete run without Rep GAP when taking the latest and previous", () => {
    const cards = repLengthCards(
      [planned(1, "2026-10-07", "2 x 6:00"), planned(2, "2026-10-14", "2 x 6:00"), planned(3, "2026-10-21", "2 x 6:00")],
      [
        activity(1, "2026-10-07", [work(360, 3.1), work(360, 3.1)]),
        activity(2, "2026-10-14", [work(360, 3.2), work(360, 3.2)]),
        activity(3, "2026-10-21", [
          { type: "WORK", movingTime: 360, gap: null, averageHeartrate: 165 },
          { type: "WORK", movingTime: 360, gap: null, averageHeartrate: 165 },
        ]),
      ],
    );
    expect(cards[0]!.latest).toMatchObject({ date: "2026-10-14" });
    expect(cards[0]!.previous).toMatchObject({ date: "2026-10-07" });
  });

  it("flags a run Over Target when any Rep's HR exceeds its own Planned Workout's ceiling, keeping it in the trend", () => {
    const cards = repLengthCards(
      [
        planned(1, "2026-10-07", "2 x 6:00 at 163–177 bpm"),
        planned(2, "2026-10-14", "2 x 6:00 at 163–177 bpm"),
        planned(3, "2026-10-21", "2 x 6:00 at 150–160 bpm"),
      ],
      [
        activity(1, "2026-10-07", [work(360, 3.1, 170), work(360, 3.1, 177)]),
        activity(2, "2026-10-14", [work(360, 3.2, 170), work(360, 3.2, 178)]),
        activity(3, "2026-10-21", [work(360, 3.3, 161), work(360, 3.3, 158)]),
      ],
    );
    expect(cards[0]!.runs.map((r) => [r.date, r.hrCeiling, r.overTarget])).toEqual([
      ["2026-10-07", 177, false],
      ["2026-10-14", 177, true],
      ["2026-10-21", 160, true],
    ]);
    expect(cards[0]!.latest).toMatchObject({ date: "2026-10-21", overTarget: true });
    expect(cards[0]!.previous).toMatchObject({ date: "2026-10-14", overTarget: true });
  });

  it("is never Over Target when its Planned Workout names no heart-rate target", () => {
    const cards = repLengthCards([planned(1, "2026-10-21", "1 x 6:00")], [activity(1, "2026-10-21", [work(360, 3.2, 200)])]);
    expect(cards[0]!.runs[0]).toMatchObject({ hrCeiling: null, overTarget: false });
  });

  it("gives Efficiency as grade-adjusted metres per heartbeat across the Reps", () => {
    const cards = repLengthCards(
      [planned(1, "2026-10-14", "2 x 6:00"), planned(2, "2026-10-21", "1 x 6:00")],
      [
        activity(1, "2026-10-14", [work(360, 3.0, 180), work(360, 3.0, 180)]),
        activity(2, "2026-10-21", [{ type: "WORK", movingTime: 360, gap: 3.2, averageHeartrate: null }]),
      ],
    );
    expect(cards[0]!.runs[0]!.efficiency).toBeCloseTo(1.0, 9);
    expect(cards[0]!.runs[1]!.efficiency).toBeNull();
  });

  it("marks where the rep count or recovery changed from the previous run with that Rep Length", () => {
    const reps = (n: number) => Array.from({ length: n }, () => work(360, 3.2));
    const cards = repLengthCards(
      [
        planned(1, "2026-09-30", "4 x 6:00", 90),
        planned(2, "2026-10-02", "2 x 10:00", 120),
        planned(3, "2026-10-07", "4 x 6:00", 90),
        planned(4, "2026-10-14", "5 x 6:00", 90),
        planned(5, "2026-10-21", "5 x 6:00", 60),
        planned(6, "2026-10-28", "4 x 6:00", 90),
      ],
      [
        activity(1, "2026-09-30", reps(4)),
        activity(2, "2026-10-02", [work(600, 3.1), work(600, 3.1)]),
        activity(3, "2026-10-07", reps(2)),
        activity(4, "2026-10-14", reps(5)),
        activity(5, "2026-10-21", reps(5)),
        activity(6, "2026-10-28", reps(4)),
      ],
    );
    expect(cards[1]!.runs.map((r) => [r.date, r.recovery, r.formatChange])).toEqual([
      ["2026-09-30", 90, null],
      ["2026-10-07", 90, null],
      ["2026-10-14", 90, { reps: 4, recovery: null }],
      ["2026-10-21", 60, { reps: null, recovery: 90 }],
      ["2026-10-28", 90, { reps: 5, recovery: 60 }],
    ]);
    expect(cards[0]!.runs[0]!.formatChange).toBeNull();
  });

  it("does not mark a recovery change when either run's recovery is unknown", () => {
    const reps = Array.from({ length: 4 }, () => work(360, 3.2));
    const cards = repLengthCards(
      [planned(1, "2026-10-07", "4 x 6:00", null), planned(2, "2026-10-14", "4 x 6:00", 90)],
      [activity(1, "2026-10-07", reps), activity(2, "2026-10-14", reps)],
    );
    expect(cards[0]!.runs.map((r) => r.formatChange)).toEqual([null, null]);
  });

  it("leaves out Matched Quality Runs whose intervals have not been fetched", () => {
    const cards = repLengthCards([planned(1, "2026-10-21", "4 x 6:00")], [activity(1, "2026-10-21", null)]);
    expect(cards[0]!.runs).toEqual([]);
  });
});
