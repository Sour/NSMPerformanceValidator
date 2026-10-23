import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { loadSyncStatus, saveSync } from "./store";
import { createSyncRunner } from "./syncRunner";

const now = () => new Date("2026-10-23T12:00:00Z");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("sync runner", () => {
  it("runs one sync at a time: a run requested while one is running joins it", async () => {
    const db = openDb(":memory:");
    const gate = deferred();
    let calls = 0;
    const runner = createSyncRunner(db, async () => {
      calls++;
      await gate.promise;
    }, now);

    const first = runner.run();
    const second = runner.run();
    expect(runner.running).toBe(true);
    gate.resolve();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(runner.running).toBe(false);
  });

  it("starts a new sync once the previous one has finished", async () => {
    let calls = 0;
    const runner = createSyncRunner(openDb(":memory:"), async () => void calls++, now);
    await runner.run();
    await runner.run();
    expect(calls).toBe(2);
  });

  it("records a failed sync's error, keeping when the last successful one finished and what it synced through", async () => {
    const db = openDb(":memory:");
    saveSync(db, { from: "2026-10-01", to: "2026-10-30" }, [], [], {
      finishedAt: "2026-10-22T08:00:00.000Z",
      syncedThrough: "2026-10-22",
    });
    const runner = createSyncRunner(db, async () => {
      throw new Error("intervals.icu events failed: 401 Unauthorized");
    }, now);

    await runner.run();

    expect(loadSyncStatus(db)).toEqual({
      finishedAt: "2026-10-23T12:00:00.000Z",
      error: "intervals.icu events failed: 401 Unauthorized",
      succeededAt: "2026-10-22T08:00:00.000Z",
      syncedThrough: "2026-10-22",
    });
    expect(runner.running).toBe(false);
  });
});
