# Senior Phone AI

Senior Phone AI is a phone-native assistant designed to give older people access to realtime information, reminders and simple phone actions through an ordinary phone call. The intended live architecture uses one OpenAI Realtime agent with typed tools; CALL-E is reserved for explicitly approved outbound phone actions.

This directory contains the application scaffold and a protected developer-only OpenAI Realtime microphone harness. It does not yet connect a telephone provider, live search, SMS, Supabase or CALL-E.

## Quick start

Use Node.js 22.9 or newer.

```bash
cd apps/typescript/senior-phone-ai
npm ci
copy .env.example .env
npm run dev
```

Open <http://localhost:3000>. `SENIOR_PHONE_AI_MODE` defaults to `preview` when it is absent. The health route at `/api/health` reports that side effects are disabled.

### Live local Realtime harness

The `/realtime` page is disabled by default. To run it locally, set these server-only values in `.env`:

```dotenv
SENIOR_PHONE_AI_MODE=live
OPENAI_API_KEY=your-server-api-key
```

Start the app, open <http://127.0.0.1:3000/realtime> and choose **Start live session**. The browser will ask for microphone permission. Starting a session makes a live OpenAI request and can incur usage. Test follow-up turns, speak while the assistant is talking to verify interruption, then choose **End session** and confirm the browser microphone indicator stops.

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

`.env.example` names planned server integrations and contains no usable credentials. Keep `.env.local` local; it is ignored. Values named `*_API_KEY`, `*_AUTH_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are server-only and must never be exposed through `NEXT_PUBLIC_*`, client components, logs or committed fixtures.

Unknown runtime modes fail closed. The Realtime route requires live mode and an exact same loopback origin before it creates a rate-limited, 60-second client secret. Requests addressed through a LAN or public hostname are rejected. The long-lived OpenAI key remains on the server and the browser has no credential input. This local-only harness is not end-user authentication and must not be deployed as a public route.

## Side effects and safety

The Realtime harness can stream microphone audio only after explicit operator action. It cannot place calls, send SMS, search or schedule work. The other provider adapters return `previewed` without contacting a network.

Later live features must require explicit user intent, exact action-bound consent, strict E.164 validation, masked phone output, durable idempotency and reconciliation after uncertain dispatch. The assistant must identify itself as AI and must not act as a doctor, therapist, emergency service or substitute for family and carers.

## Cancellation and rollback

Choose **End session**, close the page or stop the server to close a local Realtime session. The SDK owns the harness microphone stream and stops its tracks on close. Removing the app directory removes only local source and build output.

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

- The Realtime browser flow still needs a credentialed manual microphone test; there is no inbound phone integration.
- There is no live search, SMS delivery, persistence, reminder scheduling or dashboard.
- Preview adapters exercise safe interfaces only; they do not prove provider compatibility.
- The live same-call search gate remains unverified.
