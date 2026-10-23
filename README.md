# NSM Performance Validator

Tracks progress on a Norwegian Singles Method training plan from intervals.icu data. See `CONTEXT.md` for the vocabulary.

## Running locally

Create `.env` with:

```
INTERVALS_ATHLETE_ID=i12345
INTERVALS_API_KEY=...
```

Optional: `DATABASE_PATH` (default `data/nsm.db`), `PORT` (default `3000`) and `SYNC_INTERVAL` (default `30m`; also takes e.g. `1h` or `90s`).

```
npm install
npm run sync    # pull Planned Workouts and running Activities into SQLite once
npm run dev     # API on :3000, page on Vite's dev server
```

Or `npm run build && npm start` to serve the built page and the API together on `PORT`.

The server syncs on start and then every `SYNC_INTERVAL`; the page's **Sync now** button syncs on demand. After the first sync, each sync only re-fetches from a week before the last successful one, so edits on intervals.icu to older Planned Workouts or Activities, and a newly tagged earlier `[NSM]` start, are not picked up. To re-fetch everything since the `[NSM]` start, delete the `sync_status` row and sync again; to pick up an earlier `[NSM]` start, delete the database.

`npm test` runs the tests; `npm run typecheck` checks types. After changing `src/server/db/schema.ts`, run `npm run db:generate` to add a migration.
