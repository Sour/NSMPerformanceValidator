import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** Opens (creating if needed) the SQLite database at `path` and brings its schema up to date. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = drizzle(new Database(path), { schema });
  migrate(db, { migrationsFolder });
  return db;
}
