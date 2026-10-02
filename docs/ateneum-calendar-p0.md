# Ateneum Google Calendar (P0)

## Behaviour

- Calendar write runs only when a **mutual** activity reaches **both partner acceptances** for the current version.
- Hook: `POST /api/ateneum/activities/:id/accept` → `syncActivityCalendarAfterMutualAccept`.
- Response may include `calendar: { ok, eventId, backend, htmlLink?, error?, skipped? }`.
- Accept still succeeds if calendar fails (error is logged; `activity` is returned).
- Counter-proposal / content edit / reopen / `skipped` clears `google_event_id` and deletes the old event.

## Module

- `server/ateneum-calendar.ts` — OAuth refresh + Calendar API (no `googleapis` package)
- `server/ateneum-env.ts` — loads `.env`, `.env.local`, `.env.google` without dotenv

## Env

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
ATENEUM_GOOGLE_CALENDAR_ID=juuso.jaakkola@gmail.com
# optional
ATENEUM_PUBLIC_URL=https://jaakkola.xyz
ATENEUM_CALENDAR_TIME_ZONE=Europe/Helsinki
ATENEUM_CALENDAR_BACKEND=google   # memory|google|off
```

Local secrets live in gitignored `.env` / `.env.google` (derived from Hermes token).

## Schema

`ateneum_activities.google_event_id` — additive migration in `migrateAteneumSchema`.

## Tests

- `tests/ateneum/calendar.test.ts` — memory backend
- `npm run test:ateneum`
- Live smoke (optional): `ATENEUM_DB_PATH=/tmp/x.db npx tsx script/calendar-live-smoke.ts`

## Not in this slice

- Body-practice survey / weekly program generator
- Production deploy to Teppo
- Dual-calendar / Hennan own Google account write
- Confirmation email copy change on mutual accept (proposal email still fires on create)
