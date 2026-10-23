import { describe, expect, it } from "vitest";
import { createApp, type SyncStatusResponse } from "./app";
import { openDb } from "./db";
import { saveSync } from "./store";
import type { SyncRunner } from "./syncRunner";

describe("/api/sync", () => {
  it("reports that no sync has finished yet", async () => {
    const app = createApp(openDb(":memory:"), () => "2026-10-23", idleRunner());
    const res = await app.request("/api/sync");
    expect(await res.json()).toEqual<SyncStatusResponse>({
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastError: null,
      running: false,
    });
  });

  it("POST runs a sync and responds with its outcome once it has finished", async () => {
    const db = openDb(":memory:");
    const runner = idleRunner(() =>
      saveSync(db, { from: "2026-10-01", to: "2026-10-30" }, [], [], {
        finishedAt: "2026-10-23T12:00:00.000Z",
        syncedThrough: "2026-10-23",
      }),
    );
    const app = createApp(db, () => "2026-10-23", runner);

    const res = await app.request("/api/sync", { method: "POST" });

    expect(await res.json()).toEqual<SyncStatusResponse>({
      lastFinishedAt: "2026-10-23T12:00:00.000Z",
      lastSucceededAt: "2026-10-23T12:00:00.000Z",
      lastError: null,
      running: false,
    });
  });
});

function idleRunner(sync = () => {}): SyncRunner {
  return { run: async () => sync(), running: false };
}
