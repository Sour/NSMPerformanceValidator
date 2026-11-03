import { describe, expect, it } from "vitest";
import { formatAerobicDecoupling, formatAerobicDecouplingChange, garminNotice, thresholdChangeText } from "./format";

const since = "2026-11-02T08:00:00";

describe("garminNotice", () => {
  it("says since when thresholds have not synced, and how to fix a rejected key", () => {
    expect(garminNotice({ kind: "KeyRejected", since })).toBe(
      "Garmin key rejected since 2 Nov: thresholds not synced. If it has expired, create a new key in Garmin Connect.",
    );
    expect(garminNotice({ kind: "Unreachable", since })).toBe("Garmin unreachable since 2 Nov: thresholds not synced.");
    expect(garminNotice({ kind: "Unexpected", since })).toBe(
      "Garmin gave an unexpected response since 2 Nov: thresholds not synced.",
    );
  });
});

describe("thresholdChangeText", () => {
  it("names each threshold that changed, from what to what, and when", () => {
    expect(thresholdChangeText({ at: since, lthr: { from: 175, to: 173 }, maxHr: { from: 197, to: 194 } })).toBe(
      "LTHR 175 → 173, Max HR 197 → 194 from Garmin, 2 Nov",
    );
    expect(thresholdChangeText({ at: since, lthr: null, maxHr: { from: null, to: 194 } })).toBe(
      "Max HR set to 194 from Garmin, 2 Nov",
    );
  });
});

describe("formatAerobicDecoupling", () => {
  it("shows a run's Aerobic Decoupling to one decimal place, with a minus sign when negative, or a dash", () => {
    expect(formatAerobicDecoupling(3.84)).toBe("3.8%");
    expect(formatAerobicDecoupling(-1.25)).toBe("−1.3%");
    expect(formatAerobicDecoupling(-0.01)).toBe("0.0%");
    expect(formatAerobicDecoupling(null)).toBe("–");
  });
});

describe("formatAerobicDecouplingChange", () => {
  it("shows a change in percentage points with its sign", () => {
    expect(formatAerobicDecouplingChange(-1.44)).toBe("−1.4 pts");
    expect(formatAerobicDecouplingChange(0.96)).toBe("+1.0 pts");
    expect(formatAerobicDecouplingChange(0.04)).toBe("±0.0 pts");
  });
});
