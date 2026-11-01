import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { config, localToday } from "./config";
import { openDb } from "./db";
import { createIntervalsClient } from "./intervals";
import { createIntervalsDestination } from "./intervalsDestination";
import { refetchActivity, sync } from "./sync";
import { createSyncRunner } from "./syncRunner";

const db = openDb(config.databasePath);
const client = createIntervalsClient(config.athleteId, config.apiKey);
const syncRunner = createSyncRunner(db, () => sync(db, client, localToday()));

const app = createApp(
  db,
  localToday,
  syncRunner,
  { lt1Hr: config.lt1Hr },
  (activityId) => refetchActivity(db, client, activityId),
  createIntervalsDestination(client),
);
app.use("/*", serveStatic({ root: "dist/client" }));
// Each page has its own URL, which the client routes; a refresh on one is served the app.
const page = serveStatic({ path: "dist/client/index.html" });
app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : page(c, next)));

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`NSM Performance Validator on http://localhost:${port}`);
});

void syncRunner.run();
setInterval(() => void syncRunner.run(), config.syncInterval);

// As PID 1 in a container, Node ignores stop signals unless it handles them.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
