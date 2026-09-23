# Contributing to hevyfree2garmin

## Dev setup

```bash
cd web
cp .env.example .env.local   # point DATABASE_URL at a Postgres you can write to
npm ci
npm run dev                  # http://localhost:8096
```

## Checks

Run these before opening a PR; CI (`.github/workflows/ci.yml`) runs the same:

```bash
npx tsc --noEmit
npm run lint -- --max-warnings 0
npm test
npm run build
npm run e2e        # Playwright smoke test, desktop and mobile
```

## Workflow

1. Branch from `main`.
2. Keep commits small and focused. Conventional prefixes (`feat:`, `fix:`, `docs:`) are appreciated.
3. Open a PR and wait for CI.

A sync that uploads to Garmin is hard to undo (a bad upload is a duplicate activity on Garmin and Strava), so every live path stays behind an explicit user action and the engine's dry-run default. Keep it that way.
