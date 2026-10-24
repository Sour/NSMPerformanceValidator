import { describe, expect, it } from "vitest";
import { localToday, parseInterval } from "./config";

describe("localToday", () => {
  // 05:30 UTC on Monday 26 Oct 2026 is still 22:30 on Sunday 25 Oct in Los Angeles.
  const mondayInUtc = new Date("2026-10-26T05:30:00Z");

  it("is the date in the athlete's time zone, so the Training Week turns over at its midnight", () => {
    expect(localToday(mondayInUtc, "America/Los_Angeles")).toBe("2026-10-25");
  });

  it("is not the UTC date", () => {
    expect(localToday(mondayInUtc, "UTC")).toBe("2026-10-26");
  });
});

describe("parseInterval", () => {
  it.each([
    ["30m", 30 * 60_000],
    ["1h", 60 * 60_000],
    ["90s", 90_000],
    ["45", 45 * 60_000],
    [" 2h ", 2 * 60 * 60_000],
  ])("reads %j", (value, ms) => {
    expect(parseInterval(value)).toBe(ms);
  });

  it.each(["", "0m", "-5m", "half an hour", "10d", "1000h"])("rejects %j", (value) => {
    expect(() => parseInterval(value)).toThrow(/SYNC_INTERVAL/);
  });
});
