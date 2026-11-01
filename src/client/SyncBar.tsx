import { useEffect, useRef, useState } from "react";
import type { SyncStatusResponse } from "../server/app";
import { getJson } from "./api";
import { formatDateTime } from "./format";

/** How often the page checks for syncs it did not start, such as scheduled ones. */
const SYNC_POLL_MS = 60_000;

/** Shows the latest sync and offers Sync now; calls `onSynced` whenever a sync has finished since the page loaded. */
export function SyncBar({ onSynced }: { onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const seenFinishedAt = useRef<string | null | undefined>(undefined);

  async function show(next: SyncStatusResponse) {
    setStatus(next);
    const isNewSync = seenFinishedAt.current !== undefined && next.lastFinishedAt !== seenFinishedAt.current;
    seenFinishedAt.current = next.lastFinishedAt;
    if (isNewSync) await onSynced();
  }

  async function request(init?: RequestInit) {
    try {
      await show(await getJson<SyncStatusResponse>("/api/sync", init));
      setRequestError(null);
    } catch (e) {
      setRequestError((e as Error).message);
    }
  }

  useEffect(() => {
    void request();
    const timer = setInterval(() => void request(), SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function syncNow() {
    setSyncing(true);
    await request({ method: "POST" });
    setSyncing(false);
  }

  const running = syncing || status?.running;
  return (
    <div className="sync">
      <span className="sync-time">
        {running
          ? "Syncing…"
          : status?.lastSucceededAt
            ? `Last synced ${formatDateTime(status.lastSucceededAt)}`
            : "Not synced yet"}
      </span>
      <button type="button" onClick={syncNow} disabled={running}>
        Sync now
      </button>
      {status?.lastError && (
        <p className="error">
          Last sync failed {status.lastFinishedAt && formatDateTime(status.lastFinishedAt)}: {status.lastError}
        </p>
      )}
      {requestError && <p className="error">Could not reach the server: {requestError}</p>}
    </div>
  );
}
