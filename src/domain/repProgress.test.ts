import { describe, expect, it } from "vitest";
import type { PlannedWorkout } from "./matching";
import type { DetectedInterval } from "./qualityRun";
import { repLengthCards, type AnalysedActivity } from "./repProgress";

function planned(id: number, date: string, name: string): PlannedWorkout {
  return { id, date, name, pairedActivityId: `a${id}` };
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

  it("leaves out Matched Quality Runs whose intervals have not been fetched", () => {
    const cards = repLengthCards([planned(1, "2026-10-21", "4 x 6:00")], [activity(1, "2026-10-21", null)]);
    expect(cards[0]!.runs).toEqual([]);
  });
});
