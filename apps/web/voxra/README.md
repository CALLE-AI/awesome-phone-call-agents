# Voxra Web App

Voxra is a Next.js dashboard for making and reviewing CALL-E powered outbound phone calls. It provides brokered login, server-side session handling, call planning, call execution, call history, transcripts, analytics summaries, and webhook settings.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Required configuration is documented in `.env.example`:

- `CALLE_BROKER_BASE_URL`
- `CALLE_MCP_URL`
- `CALLE_SESSION_ENCRYPTION_KEY`
- Redis configuration via `REDIS_URL` or `AZURE_REDIS_HOST` plus `AZURE_REDIS_PASSWORD`

Use a high-entropy `CALLE_SESSION_ENCRYPTION_KEY` in every non-local environment.

## Scripts

```bash
npm run lint
npm test
npm run build
npm run start
```

## Side Effects

This app can initiate real outbound phone calls through CALL-E when an authenticated user submits a call request. Use fictional reserved numbers for demos and only call real numbers when the recipient is authorized and the request is explicit.

## Credential Handling

Browser login is brokered through CALL-E. Access tokens and session state are handled server-side and encrypted before being stored in cookies or Redis-backed session records. Do not commit `.env.local`, Redis credentials, broker secrets, or access tokens.

## Preview And Dry Run

The call planning endpoint can be used to preview a call goal before execution. A real call is only started by the run flow after authenticated user action.

## Cancellation And Rollback

Voxra starts one-off calls and does not create recurring schedules. To stop future calls, do not submit another run request. In-flight call cancellation depends on CALL-E/provider support exposed by the upstream service.

## Production Checklist

- Configure production environment variables in the host platform.
- Use Redis with TLS for distributed session storage and rate limiting.
- Set a unique high-entropy session encryption key.
- Verify callback and webhook URLs for the deployment domain.
- Run `npm run lint`, `npm test`, and `npm run build` before deployment.
