import { describe, expect, it } from "vitest";
import { formatDuration, secondsPerMile } from "./pace";

describe("pace", () => {
  it("converts a speed in metres per second to seconds per mile", () => {
    expect(secondsPerMile(1609.344 / 480)).toBeCloseTo(480, 9);
  });

  it("formats seconds as m:ss, rounding to the second", () => {
    expect(formatDuration(479.6)).toBe("8:00");
    expect(formatDuration(425.2)).toBe("7:05");
  });
});
