# NSM Performance Validator

Tracks progress on a Norwegian Singles Method training plan from intervals.icu data. See `CONTEXT.md` for the vocabulary.

## Running locally

Create `.env` with:

```
INTERVALS_ATHLETE_ID=i12345
INTERVALS_API_KEY=...
```

Optional: `DATABASE_PATH` (default `data/nsm.db`) and `PORT` (default `3000`).

```
npm install
npm run sync    # pull Planned Workouts and running Activities into SQLite
npm run dev     # API on :3000, page on Vite's dev server
```

Or `npm run build && npm start` to serve the built page and the API together on `PORT`.

`npm test` runs the tests; `npm run typecheck` checks types. After changing `src/server/db/schema.ts`, run `npm run db:generate` to add a migration.
