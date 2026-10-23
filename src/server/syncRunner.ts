import type { Db } from "./db";
import { recordSyncFailure } from "./store";

/** Runs syncs one at a time, for the schedule and the Sync now button alike. */
export interface SyncRunner {
  /** Starts a sync, or joins the one already running; resolves when it has finished, whether or not it succeeded. */
  run(): Promise<void>;
  readonly running: boolean;
}

/** `sync` records its own success; the runner records its failure. */
export function createSyncRunner(db: Db, sync: () => Promise<unknown>, now = () => new Date()): SyncRunner {
  let current: Promise<void> | null = null;
  return {
    run() {
      current ??= sync()
        .then(
          () => {},
          (e: unknown) => {
            console.error("Sync failed:", e);
            recordSyncFailure(db, now().toISOString(), e instanceof Error ? e.message : String(e));
          },
        )
        .finally(() => {
          current = null;
        });
      return current;
    },
    get running() {
      return current !== null;
    },
  };
}
