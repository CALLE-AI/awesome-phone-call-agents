# Cursor implementation prompt (merged)

This pack was merged into the existing `call-aunty-2026` app.

- Server modules live in `server/calle-v4/` (not a second Express process).
- Routes mount on the existing bootstrap in `server/_core/index.ts`.
- Drizzle tables were converted from the pack's PostgreSQL sketch to the repo's MySQL dialect in `drizzle/schema.ts`.
- The previous `server/calle/` command-center / SDK adapter stack is unchanged.
- React Native uses `hooks/use-calle-call.ts`, `lib/calle-v4/`, and `components/calle-v4/`.
- `CALLE_API_KEY` stays server-side. Demo mode is the default.
