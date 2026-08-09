# RecallReady

**A public recall record tells you what was recalled. RecallReady uses one carefully constrained phone call to find out whether your exact item qualifies and what to do next.**

RecallReady is a privacy-minimized TypeScript application built for **CALL-E: Your Code Is Calling**. It combines the official U.S. Consumer Product Safety Commission recall API with CALL-E's structured phone-call runtime.

The workflow is deliberately narrow:

1. Search public recall records by product or brand.
2. Select a record and provide only a model and optional non-sensitive date/batch code.
3. Preview the masked destination, goal, hard boundaries, and expiration.
4. Type `CALL NOW` to authorize exactly one mock or live call.
5. Receive eligibility, remedy, required proof, deadline, confidence, evidence, and the next safe step—not a stored transcript.

## Why phone is the missing layer

Recall data can identify hazards, affected model families, remedies, and public contact channels. It often cannot answer the owner's last-mile questions: Does this date code qualify? Is the remedy still available? What proof is required? Is a human case needed?

RecallReady grounds the call in the official record and prevents the agent from becoming a generic errand caller. It refuses sensitive information and binding actions, treats uncertainty as uncertainty, and hands the task back to a person when the hotline requires more.

## Safety defaults

- Mock/no-call mode is the default.
- Live mode requires `LIVE_CALLS_ENABLED=true`, a server-side `CALL_E_API_KEY`, an unexpired preview, and the exact phrase `CALL NOW`.
- Authorized demo numbers require an explicit ownership/permission attestation.
- Official calls use only the number published in the selected CPSC record.
- Phone numbers remain server-side and are returned to the browser only in masked form.
- The task prohibits names, addresses, emails, accounts, orders, payment data, passwords, health information, and full serial numbers.
- The task cannot buy, accept terms, schedule service, claim an item is safe, or give medical/legal/emergency advice.
- A preview is single-use and expires after 15 minutes.
- Transcripts and phone numbers are not persisted by RecallReady.

CALL-E may retain service-side operational data under its own terms; operators should review those terms before using live mode.

## Run locally

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm check
pnpm dev
```

Open `http://127.0.0.1:8788`. Search and mock verification work without CALL-E credentials.

## Opt-in live verification

Create a CALL-E account and obtain the API key using the official integration instructions. Keep the key server-side.

```bash
export CALL_E_API_KEY="<server-side key>"
export LIVE_CALLS_ENABLED="true"
pnpm dev
```

For a contest demo, enter only a number you own or are explicitly authorized to call, check the consent attestation, inspect the preview, then type `CALL NOW`. Each preview can execute once.

To cancel before a call, do nothing—the preview expires. There are no recurring jobs. Once an outbound call has started, RecallReady makes no claim that it can recall the phone network side effect; stop the app and use CALL-E's own controls if intervention is needed.

## Architecture

```text
Browser UI
   │ search / select / preview / explicit approval
   ▼
Node HTTP application
   ├── official CPSC REST API (public recall grounding)
   ├── single-use in-memory preview store
   ├── mock provider (default, deterministic, no call)
   └── CALL-E SDK provider (opt-in live call + structured result)
```

Important files:

- `src/cpsc.ts` — official recall API adapter.
- `src/call-task.ts` — constrained call task and JSON result schema.
- `src/workflow.ts` — consent, preview, expiry, idempotency, and one-call gate.
- `src/providers.ts` — deterministic mock and actual `CalleClient` runtime.
- `public/` — complete user-facing workflow.
- `test/` — unit, integration, safety, and privacy checks.

## Testing

```bash
pnpm check
```

Tests cover official-data parsing, phone extraction/masking, demo consent, single-use previews, expiry, exact approval, structured mock results, task boundaries, and private-data markers.

No test places a real phone call.

## Workflow value

- Makes safety recalls actionable without forcing a person to navigate an uncertain hotline blindly.
- Combines authoritative public grounding with a minimum-data phone-resolution layer instead of operating as a generic caller.
- Imports and invokes CALL-E through `CalleClient`; structured output, mock/live provider separation, approval, idempotency, masking, and fail-closed states are implemented.
- Shows the whole path from official search to a human-readable remedy plan, with a safe no-call route available by default.

See `docs/privacy-and-safety.md` for the detailed safety audit.

## Data and licenses

- Application code: MIT, copyright Bradley Grubbs.
- Recall data: public information retrieved from the official CPSC/saferproducts.gov service at runtime. It is not bundled or redistributed in the repository.
- No employer, customer, household, or work data is used.
- No third-party music, logos, stock images, or proprietary media are included.

## Status

The app, mock path, tests, and public documentation are complete. A truthful live-demo claim requires one real CALL-E run to an owned or explicitly authorized test number; until that evidence exists, the repository does not claim that a live call succeeded.
