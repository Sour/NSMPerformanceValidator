import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env)`);
  return value;
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
};

/** Today's date in the server's local time zone, YYYY-MM-DD. */
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}
