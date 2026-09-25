# Changelog

All notable changes to hevyfree2garmin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Syncing is faster: half a second between Garmin calls instead of a full one, and no second heart-rate request for workouts that ended more than two days ago.
- **Sync all** runs on the server in 30-second blocks that chain into each other, so it keeps going when the page is closed or the phone locks. The dashboard picks up the progress when it opens again.

### Fixed

- The first sync after a CSV import failed with "Invalid time value" when no timing settings were saved and the workout was merged into a watch activity.
- A database connected in Vercel Storage with a custom prefix (for example `HEVY_POSTGRES_URL`) is found. The "no database" notice also lists the database variables the deployment can see.

## [0.1.0] - 2026-09-23

First release, forked from [hevy2garmin](https://github.com/drkostas/hevy2garmin)
(web dashboard and TypeScript engine 0.9.0) by Konstantinos Georgiou, MIT.

### Changed

- Workouts come only from a Hevy CSV export. No Hevy Pro or API key is needed.
- The import can upload new workouts to Garmin right away, with live progress.
- The sync engine is part of the web app (`web/engine`) instead of an npm dependency.
- The dashboard has one sync card (Preview, Sync next, Sync all).
- The mobile layout has four tabs plus a More menu, and tables scroll sideways.

### Removed

- Everything that used the Hevy API: API key setup, the Hevy webhook, routines (Hevy routines as Garmin planned workouts), and the Hevy API client.
- Auto-sync through GitHub Actions and the GitHub token setting. The daily Vercel cron still syncs pending imported workouts.
- The Python package and CLI, the Docker image, and the Expo app.
