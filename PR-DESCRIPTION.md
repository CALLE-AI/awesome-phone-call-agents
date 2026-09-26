# AfterHold — workspace, auth, mission state machine, safety layer for CALL-E

This PR adds a new skill (`afterhold-ivr-errand`) plus a runnable TypeScript app
(`apps/typescript/afterhold-api`) to `awesome-phone-call-agents`.

## What's inside

```
skills/afterhold-ivr-errand/
  SKILL.md
  references/
    result-schema.md       canonical envelope + per-archetype facts
    task-template.md        exact task-string format + hard refusals
    server.md               env, endpoints, worker cadence
    failure-mapping.md      server §17 mapping table
  examples/
    courier.json
    clinic.json
    restaurant.json
    utility.json
  scripts/
    dry-run.mjs             boots a mock-mode mission end-to-end
    run-mission.mjs         runs a mission from a JSON payload

apps/typescript/afterhold-api/
  README.md
  package.json
  tsconfig.json
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  src/
    server.ts               Fastify entry
    routes/{auth,missions,numbers}.ts
    services/{auth,missions,safety,taskString,resultSchema}.ts
    workers/missionWorker.ts
    adapters/calle.ts        real + mock CALLE adapter
    lib/{env,db,types,util}.ts
```

## How the system is shaped

```
iOS (expo-secure-store JWT) ── HTTPS ──► AfterHold API ── HTTPS ──► CALL-E Developer API
                                       │
                                       ├── Postgres / SQLite
                                       ├── background worker (polls CALLE)
                                       └── safety gates (consent, allowlist, quiet hours, rate limit)
```

The iOS client never holds `CALLE_API_KEY`. The server holds it. The iOS client only has a
JWT for the user.

## What the skill does

Given a goal, a phone number, a language, a schedule, and a result schema, the skill:

1. Creates a draft mission in AfterHold.
2. Previews the task string (so the user can see what the surrogate will be told).
3. Starts the mission — server runs safety gates, then calls `POST /v1/calls` on CALL-E.
4. Streams events back to the iOS client via `GET /v1/missions/:id/events`.
5. Returns a `Brief` with a controlled-vocabulary `outcome` (`resolved` /
   `needs_human` / `voicemail` / `unavailable` / `refused` / `failed`) and a typed
   `facts` object keyed by archetype.

## Hard refusals (server-enforced)

The task string always includes:

- Do not make or accept any payment, transfer, or financial commitment.
- Do not provide medical, legal, or tax advice.
- Do not cancel, close, or destroy any account, subscription, or legal record.
- If the callee asks for a commitment, return `needs_human` and stop.

The server refuses to start a mission whose task string does not include the full refusal block.

## Safety gates (server-side only)

Every gate is enforced inside `services/safety.ts`. The iOS client cannot bypass them.

- `CALLE_ENABLED=0` → all `/start` calls return 503.
- No consent snapshot → 412.
- Number not on allowlist (skipped under mock) → 403.
- Quiet hours + now-call → 429.
- Rate limit (5/hour default) → 429.

## Dry-run (mock mode)

Default is real mode (`CALLE_MOCK=0`). To record the demo video or run offline, set
`CALLE_MOCK=1` in `.env`. The worker walks a scripted phase timeline:

```
draft → previewed → queued → planning → dialing → in_conversation → wrapping → completed
```

with a believable courier brief in ~20 seconds, no live CALL-E call burned. Useful for:

- Demo video (record the iOS app with mock data).
- Local development (CI can run the smoke test without keys).
- First-time setup (see the full state machine without signing up).

## Run the demo

```bash
# 1. Boot the API in real mode (set CALLE_API_KEY first)
cd apps/typescript/afterhold-api
cp .env.example .env
# Edit .env and set CALLE_API_KEY=…  (CALLE_MOCK=0 by default)
npm install
npm run dev

# 2. In another terminal, run the dry-run script
cd ../../..
node skills/afterhold-ivr-errand/scripts/dry-run.mjs
```

For mock-mode demos without burning a free-tier call, flip
`CALLE_MOCK=1` in `.env` first.

Expected output:

```
[11:24:01] logging in to http://localhost:8787
[11:24:02] granting consent
[11:24:02] allowlisting destination
[11:24:02] creating draft mission
[11:24:02] previewing (auto-renders task string)
[11:24:02] starting
[11:24:02] polling for completion…
[11:24:04]   status=planning
[11:24:06]   status=in_conversation
[11:24:20]   status=completed
[11:24:20] --- BRIEF ---
{
  "outcome": "resolved",
  "summary_for_user": "BlueDart confirmed AWB 8821 is out for delivery, expected by 4 PM today…",
  "facts": { "tracking_number": "AWB 8821", "status": "Out for delivery", ... },
  "next_step": "Track from 3:30 PM onward.",
  "callee_role": "dispatcher",
  "confidence": 0.93
}
```

## Live mode (after you have a real `CALLE_API_KEY`)

1. Set `CALLE_MOCK=0` and `CALLE_API_KEY=<key>` in `.env`.
2. Add your own E.164 to the allowlist via `POST /v1/numbers`.
3. Re-run the dry-run script. The same mission will place a real call.
4. `RATE_LIMIT_PER_HOUR=5` keeps a single user under 20 free calls in 4 hours.

## Skill portability

The skill is a portable workflow — it doesn't import any private package, and it works
against any AfterHold API deployment. Anyone can clone the apps/typescript/afterhold-api
folder, run the dry-run script, and use the skill to talk to their own AfterHold instance.

## Notes for reviewers

- We deliberately did **not** include the iOS Xcode project. The iOS client is a React Native
  + Expo managed app, and including an Xcode project in the awesome-phone-call-agents repo
  would not be portable. The README links out to the private iOS client and the demo video.
- The CALLE adapter is raw HTTPS to `api.heycall-e.com` (not the `@call-e/calle` SDK), so the
  package is self-contained and has no extra runtime dependency on the SDK's release cadence.
- Mocks are first-class. The mock timeline is the same shape as a real one (status changes,
  transcript events, brief). This is what makes the demo video possible without burning
  free calls.
- Failure modes are explicit, per the spec §17 mapping. `needs_human` is the safe default
  when the transcript is ambiguous — we do not invent facts.

## Checklist

- [x] Skill is in the correct `skills/afterhold-ivr-errand/` shape
- [x] App is in the correct `apps/typescript/afterhold-api/` shape
- [x] SKILL.md documents inputs, outputs, side effects, cancellation, credentials, dry-run
- [x] All hard refusals are server-enforced
- [x] Safety gates are server-side only
- [x] No CALLE_API_KEY leaks into the iOS client, Info.plist, or anywhere in this PR
- [x] Mocks are wired so the demo works without free calls
- [x] Failure mapping matches spec §17
