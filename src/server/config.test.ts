import { describe, expect, it } from "vitest";
import { parseInterval } from "./config";

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
