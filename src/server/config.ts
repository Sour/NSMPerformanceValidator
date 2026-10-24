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
};

/** The athlete's time zone, which Training Weeks follow; set TZ to change it. */
const ATHLETE_TIME_ZONE = process.env.TZ || "America/Los_Angeles";

/** The date at `now` in the athlete's time zone, YYYY-MM-DD. */
export function localToday(now = new Date(), timeZone = ATHLETE_TIME_ZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}
