import { describe, expect, it } from "vitest";
import { garminNotice, thresholdChangeText } from "./format";

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
