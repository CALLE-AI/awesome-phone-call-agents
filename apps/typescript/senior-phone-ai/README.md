# Senior Phone AI

Senior Phone AI is a phone-native assistant designed to give older people access to realtime information, reminders and simple phone actions through an ordinary phone call. The intended live architecture uses one OpenAI Realtime agent with typed tools; CALL-E is reserved for explicitly approved outbound phone actions.

This directory currently contains the SPA-001 application scaffold. It does not yet connect to OpenAI, a phone provider, SMS, Supabase or CALL-E. The visible experience is an honest scaffold preview, not a simulated working phone agent.

## Quick start

Use Node.js 22.9 or newer.

```bash
cd apps/typescript/senior-phone-ai
npm ci
copy .env.example .env
npm run dev
```

Open <http://localhost:3000>. `SENIOR_PHONE_AI_MODE` defaults to `preview` when it is absent. The health route at `/api/health` reports that side effects are disabled.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run check
npm run build
npm start
```

## Configuration and credentials

`.env.example` names planned server integrations and contains no usable credentials. Keep `.env` local; it is ignored. Values named `*_API_KEY`, `*_AUTH_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are server-only and must never be exposed through `NEXT_PUBLIC_*`, client components, logs or committed fixtures.

The scaffold parses only `SENIOR_PHONE_AI_MODE`. Unknown values fail closed. Provider-specific validators will be added with each integration so credentials are required only when that live capability is invoked. The app will restrict credential-bearing network requests to verified provider origins.

## Side effects and safety

The scaffold cannot place calls, send SMS or schedule work. Its only provider adapters return `previewed` without contacting a network. Setting `SENIOR_PHONE_AI_MODE=live` does not enable a provider because no live adapter exists yet.

Later live features must require explicit user intent, exact action-bound consent, strict E.164 validation, masked phone output, durable idempotency and reconciliation after uncertain dispatch. The assistant must identify itself as AI and must not act as a doctor, therapist, emergency service or substitute for family and carers.

## Cancellation and rollback

There is currently nothing external to cancel or roll back. Stop the development or production process to stop this scaffold. Removing the app directory removes only local source and build output.

Future provider actions must document their own cancellation limits. In particular, closing the browser or stopping this server must never be described as canceling a call already accepted by a provider. The host scheduler will own recurrence and must support disabling future runs.

## Project boundaries

| Directory | Responsibility |
|---|---|
| `app/` | Next.js pages and server route handlers |
| `lib/config/` | Server-only mode and provider configuration |
| `lib/realtime/` | Realtime session lifecycle and tool dispatch |
| `lib/tools/` | Typed information, SMS and reminder tools |
| `lib/calle/` | CALL-E outbound planning, execution and reconciliation |
| `lib/db/` | Supabase migrations and server persistence |
| `lib/safety/` | Consent, authorization, validation and redaction |
| `workflows/` | Durable post-call and scheduled orchestration |
| `tests/` | Offline deterministic tests using preview/fake adapters |

Implementation progress and acceptance criteria are tracked in [`docs/senior-phone-ai/README.md`](../../../docs/senior-phone-ai/README.md).

## Current limitations

- There is no realtime audio session or inbound phone integration.
- There is no live search, SMS delivery, persistence, reminder scheduling or dashboard.
- Preview adapters exercise safe interfaces only; they do not prove provider compatibility.
- The live same-call search gate remains unverified.
