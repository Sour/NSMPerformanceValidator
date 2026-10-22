import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { config, localToday } from "./config";
import { openDb } from "./db";

const app = createApp(openDb(config.databasePath), localToday);
app.use("/*", serveStatic({ root: "dist/client" }));

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`NSM Performance Validator on http://localhost:${port}`);
});
