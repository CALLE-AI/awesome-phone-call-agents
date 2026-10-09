# VaxConnect

AI-powered vaccination planning, travel guidance, and verified vaccine availability using CALL-E.

## What it does

VaxConnect helps users:

- Check child vaccination requirements
- Check travel vaccination guidance
- Find vaccine availability
- Get vaccination information and guidance through an AI assistant powered by Google Gemini
- Request appointment assistance through an AI phone agent powered by CALL-E

## AI safety and scope

VaxConnect is a demonstration application.

The Gemini-powered assistant provides general vaccination information and guidance for informational purposes. It is not a medical professional and does not provide medical diagnoses, treatment decisions, or personalized medical advice. Users should confirm vaccination decisions and requirements with a qualified healthcare professional or the relevant official health authority.

CALL-E is used to contact explicitly authorized recipients for the demonstration. **Real calls are disabled by default** and require an operator to both authenticate and opt in (see "Real-call safety gate" below).

## Setup

1. Install dependencies: `npm install`
2. Create a `.env.local` file in this directory.
3. Add the environment variables described below.
4. Run the app: `npm run dev`, then open `http://localhost:3000`.
5. Never commit `.env.local` or other credentials to the repository.

### Environment variables

| Variable | Required for | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | The vaccine-guidance assistant | Used by `/api/gemini` for the informational chat flow. |
| `CALLE_API_KEY` | Any real CALL-E call | CALL-E API key used by `/api/availability`, `/api/appointment`, and `/api/calle-test`. Not required for the no-call path below. |
| `CALLE_ENABLE_REAL_CALLS` | Any real CALL-E call | Must be the literal string `true` to allow any outbound call. **Defaults to disabled** (unset, or any value other than `true`). |
| `CALLE_INTERNAL_SECRET` | Any real CALL-E call | Shared secret the caller must present as `Authorization: Bearer <secret>` on every call-triggering route. Without it, real calls are rejected even if `CALLE_ENABLE_REAL_CALLS=true`. |
| `CALLE_ALLOWED_RECIPIENTS` | Any real CALL-E call | Comma-separated list of E.164 phone numbers (e.g. `+15551234567`) CALL-E is allowed to dial. Any recipient not in this list, or not valid E.164, is rejected before any call is placed. |
| `DEMO_PROVIDER_PHONE` | The live availability/appointment demo | A single E.164 number CALL-E will dial for the availability check and the booking demo. It must also appear in `CALLE_ALLOWED_RECIPIENTS`. |

A safe starting `.env.local` (no real calls, no CALL-E credentials required):

```env
CALLE_ENABLE_REAL_CALLS=false
CALLE_ALLOWED_RECIPIENTS=
CALLE_INTERNAL_SECRET=your-local-secret
```

### Real-call safety gate

Every route that can place a CALL-E call (`/api/availability`, `/api/appointment`, `/api/calle-test`, `/api/calle-mcp-run`, `/api/calle-mcp-test`) applies the same three checks, in order, before touching the CALL-E SDK or CLI:

1. **Operator authorization** — the request must carry `Authorization: Bearer <CALLE_INTERNAL_SECRET>`.
2. **No-call default** — `CALLE_ENABLE_REAL_CALLS` must be exactly `"true"`. Any other value (including unset) rejects the request.
3. **Authorized recipient** — the target phone number must be valid E.164 and present in `CALLE_ALLOWED_RECIPIENTS`.

If any check fails, the route returns an error and no call is placed.

### Runnable, credential-free, no-call path

You can run the full app with **no CALL-E credentials at all** by leaving `CALLE_ENABLE_REAL_CALLS` unset or `false` (the default):

1. `npm install`
2. Create `.env.local` with just `CALLE_ENABLE_REAL_CALLS=false` (or omit it entirely).
3. `npm run dev`, then open the **Availability** flow in the browser and submit a vaccine search.

With real calls disabled, `/api/availability` never contacts CALL-E or requires `CALLE_API_KEY`/`DEMO_PROVIDER_PHONE`. It returns the two demo providers directly (`source: "DEMO PROVIDER"`), with `call: null` and `realCallsEnabled: false` in the response, so the UI clearly shows the result is simulated. This is also the default behavior if you clone the repo and run it without any `.env.local` at all.

The appointment-booking flow requires a real call by design (it exists to demonstrate provider confirmation) and is disabled in this same state, returning a clear "real calls are disabled" error rather than a fabricated booking.

### Unknown outcomes

CALL-E's answers are only ever reported as what the provider actually said. VaxConnect never guesses or fills in a value it can't ground in the call:

- Availability, price, appointment requirement, and earliest availability each independently fall back to `"unknown"` / `"Not provided"` when the transcript and call summary don't contain a clear answer to that specific question.
- Booking confirmation (`booked`) is only ever `"yes"` if the provider's own words match an explicit confirmation pattern, and `"no"` on an explicit rejection. Anything else — an ambiguous answer, a dropped call, a failed connection — is reported as `"unknown"`, and the flow **stops there**: the UI shows the call as unresolved, and no appointment is presented as booked.
- A failed or incomplete call (`status !== "completed"`) is always reported as a failure, never silently treated as a successful outcome.

### Accepted-call cancellation limitations

This demo does not implement cancellation of a confirmed booking. If `/api/appointment` reports `booked: "yes"`, that confirmation was made by the provider on a single outbound call; there is no follow-up call, API, or UI action in this repository that can cancel or modify it afterward. Canceling or changing a confirmed appointment currently requires contacting the provider directly by other means (e.g. calling the number back). Treat any accepted booking from this demo as final from the app's perspective.
