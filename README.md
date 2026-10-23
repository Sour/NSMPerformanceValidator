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

## Running in Docker

`docker compose up --build` builds the image and serves the page and the API on `PORT` (default `3000`), reading the same `.env`. The database lives in the container's `/data`, mapped to `./data` (or `DATA_DIR`), so it survives restarts. Set `TZ` (e.g. `Europe/Oslo`) so "today" and the Training Week follow your time zone rather than UTC.

Every push to `master` builds the image and pushes it to `ghcr.io/sour/nsmperformancevalidator`, tagged `latest` and with the full commit SHA.

## Unraid

The app has no login, so keep it on the LAN.

1. The repo is private, so its image is too. On GitHub, create a classic personal access token with only the `read:packages` scope. On the Unraid console run `docker login ghcr.io -u <github-user>` and paste the token as the password.
2. In **Docker → Add Container**, set:
   - **Repository**: `ghcr.io/sour/nsmperformancevalidator:latest`
   - **Port**: container `3000` → any free host port
   - **Path**: container `/data` → `/mnt/user/appdata/nsm`
   - **Variables**: `INTERVALS_ATHLETE_ID`, `INTERVALS_API_KEY`, and optionally `SYNC_INTERVAL` and `TZ`
3. To update, use **Check for Updates** on the Docker tab, or pin a commit SHA tag instead of `latest`.

The API key is only read by the server; the page never sees it.

## Development

`npm test` runs the tests; `npm run typecheck` checks types. After changing `src/server/db/schema.ts`, run `npm run db:generate` to add a migration.
