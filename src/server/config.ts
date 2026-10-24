import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env)`);
  return value;
}

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;
/** The longest delay setInterval honours; longer ones fire immediately. */
const MAX_INTERVAL_MS = 2 ** 31 - 1;

/** Reads a SYNC_INTERVAL such as "30m", "1h" or "90s" as milliseconds; a bare number is minutes. */
export function parseInterval(value: string): number {
  const match = /^(\d+)([smh]?)$/.exec(value.trim());
  const ms = match ? Number(match[1]) * UNIT_MS[(match[2] || "m") as keyof typeof UNIT_MS] : 0;
  if (ms <= 0 || ms > MAX_INTERVAL_MS) throw new Error(`SYNC_INTERVAL must look like 30m, 1h or 90s, not "${value}"`);
  return ms;
}

/** The highest heart rate taken as a plausible LT1 HR, in bpm. */
const MAX_LT1_HR = 250;

/** Reads an LT1_HR such as "155" in bpm; null when it is not set, so LT1 HR is assumed. */
export function parseLt1Hr(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const bpm = /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (!(bpm > 0 && bpm <= MAX_LT1_HR)) throw new Error(`LT1_HR must be a heart rate in bpm such as 155, not "${value}"`);
  return bpm;
}

export const config = {
  get athleteId() {
    return required("INTERVALS_ATHLETE_ID");
  },
  get apiKey() {
    return required("INTERVALS_API_KEY");
  },
  databasePath: process.env.DATABASE_PATH ?? "data/nsm.db",
  port: Number(process.env.PORT ?? 3000),
  /** Milliseconds between scheduled syncs. */
  syncInterval: parseInterval(process.env.SYNC_INTERVAL ?? "30m"),
  /** The runner's own LT1 HR in bpm; null to assume it from LTHR. */
  lt1Hr: parseLt1Hr(process.env.LT1_HR),
};

/** The athlete's time zone, which Training Weeks follow; set TZ to change it. */
const ATHLETE_TIME_ZONE = process.env.TZ || "America/Los_Angeles";

/** The date at `now` in the athlete's time zone, YYYY-MM-DD. */
export function localToday(now = new Date(), timeZone = ATHLETE_TIME_ZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}
