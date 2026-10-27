# NSM Performance Validator

Tracks progress on a Norwegian Singles Method training plan from intervals.icu data. See `CONTEXT.md` for the vocabulary.

## Running locally

Create `.env` with:

```
INTERVALS_ATHLETE_ID=i12345
INTERVALS_API_KEY=...
```

Optional: `DATABASE_PATH` (default `data/nsm.db`), `PORT` (default `3000`), `SYNC_INTERVAL` (default `30m`; also takes e.g. `1h` or `90s`) and `LT1_HR` (your LT1 heart rate in bpm, e.g. `155`, from a test; without it, LT1 HR is assumed to be 88% of LTHR).

```
npm install
npm run sync    # pull Planned Workouts and running Activities into SQLite once
npm run dev     # API on :3000, page on Vite's dev server
```

Or `npm run build && npm start` to serve the built page and the API together on `PORT`.

The server syncs on start and then every `SYNC_INTERVAL`; the page's **Sync now** button syncs on demand. After the first sync, each sync only re-fetches from a week before the last successful one, so edits on intervals.icu to older Planned Workouts or Activities, and a newly tagged earlier `[NSM]` start, are not picked up. To pick up a fix to an older Quality Run's intervals, open its run drawer and use **Re-fetch from intervals.icu**, which reloads that one Activity whatever its age; the drawer shows when intervals.icu last changed its intervals. To re-fetch everything else since the `[NSM]` start, such as edits to older Planned Workouts, delete the `sync_status` row and sync again; to pick up an earlier `[NSM]` start, delete the database.

## Running in Docker

`docker compose up --build` builds the image and serves the page and the API on `PORT` (default `3000`), reading the same `.env`. The database lives in the container's `/data`, mapped to `./data` (or `DATA_DIR`), so it survives restarts. "Today" and the Training Week follow `America/Los_Angeles`; set `TZ` (e.g. `Europe/Oslo`) to follow another time zone.

Every push to `master` builds the image and pushes it to `ghcr.io/sour/nsmperformancevalidator`, tagged `latest` and with the full commit SHA.

## Unraid

The app has no login, so keep it on the LAN.

1. The repo is private, so its image is too. On GitHub, create a classic personal access token with only the `read:packages` scope. On the Unraid console run `docker login ghcr.io -u <github-user>` and paste the token as the password.
2. Copy `unraid/nsm-performance-validator.xml` to `/boot/config/plugins/dockerMan/templates-user/my-NSMPerformanceValidator.xml` on the Unraid flash drive (e.g. through the `flash` share).
3. In **Docker → Add Container**, pick **NSMPerformanceValidator** under **Template**, fill in the intervals.icu Athlete ID and API Key, and adjust the port, `/data` path (default `/mnt/user/appdata/nsm`), Sync Interval, LT1 HR and Time Zone if needed. Without the template, set the same fields by hand: repository `ghcr.io/sour/nsmperformancevalidator:latest`, container port `3000`, container path `/data`, and the variables `INTERVALS_ATHLETE_ID`, `INTERVALS_API_KEY`, `SYNC_INTERVAL`, `LT1_HR` and `TZ`.
4. To update, use **Check for Updates** on the Docker tab, or pin a commit SHA tag instead of `latest`.

The API key is only read by the server; the page never sees it.

## Development

`npm test` runs the tests; `npm run typecheck` checks types. After changing `src/server/db/schema.ts`, run `npm run db:generate` to add a migration.
