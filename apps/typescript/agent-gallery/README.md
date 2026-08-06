# CareCall SG

CareCall SG is a Singapore-focused care companion calling workspace for caregiver-authorized medication reminders, meal check-ins, self-reported outcomes, and human escalation.

> CareCall reminds seniors about approved everyday routines, records what they report, and directs exceptions to a human. It does not provide medical advice, verify adherence, dispatch emergency services, or replace human care.

The product and UI implementation source of truth is [`docs/agent-gallery/carecall-sg-ui-plan.md`](../../../docs/agent-gallery/carecall-sg-ui-plan.md).

## Current status

The CareCall single-call and controlled-recurrence foundation is implemented:

- responsive desktop and mobile navigation
- Today dashboard and care timeline
- fictional Singapore senior profiles
- medication and meal care routines
- visible durable pause, resume, and cancellation controls
- exception-only Needs Attention workspace
- Singapore timezone, call-window, privacy, and safety settings
- masked phone numbers
- dry-run call preview with trust-first opening and explicit safety boundaries
- separate authorization for exactly one real call
- CareCall-specific medication and meal request validation
- trust-first CALL-E goals with medical, emergency, and anti-scam boundaries
- live provider-status polling and conservative structured outcomes
- operational urgency (`contact now`, `follow up today`, or `review`)
- safety flags for possible immediate danger, medical advice, sensitive-data requests, and unconfirmed dispatch claims
- session routing of live exceptions into Needs Attention
- signed, expiring operator sessions with senior-scoped authorization
- durable request claims, daily spending limits, call ownership, outcomes, attention cases, and audit events
- caregiver-authorized daily or weekday schedules with an explicit review date
- encrypted scheduled phone numbers, dated call exceptions, and terminal cancellation that removes the ciphertext
- one durable queue for manual and scheduled calls, with a single active-call lease and cancellable queued jobs
- a protected Calls console for queue position, active state, provider timing, duration, history, and review cases
- signed QStash delivery for exact-time wake-ups and background provider-status monitoring
- a once-daily host reconciliation cron that repairs state but never initiates late calls
- stable occurrence keys, no blind call retries, and fail-closed human review
- English-only live-call enforcement until other languages are verified
- accessible focus, reduced-motion, reduced-transparency, high-contrast, and dark-mode behavior

The interface uses fictional demo data and says so visibly. Settings changes remain session-only demonstrations. When the durable operations environment is configured, live-call ownership, snapshots, outcomes, attention cases, acknowledgements, limits, audits, and recurring schedules are stored server-side. The full phone number is entered only at a one-call or recurring authorization gate; call snapshots retain only a masked suffix, while active recurring schedules retain an encrypted phone number until cancellation.

The CareCall path is implemented but has not yet been verified with a consenting recipient through the deployed interface. Do not represent it as operationally proven until that opt-in verification is complete.

## Product boundary

CareCall may:

- repeat a caregiver-approved reminder
- ask one clear follow-up question at a time
- record only self-reported medication or meal outcomes
- ask whether food is available or a planned delivery arrived
- offer a callback from an authorized caregiver
- route ambiguity, uncertainty, and requests for help to a human

CareCall must never:

- diagnose a condition or recommend a dose
- advise a senior to repeat, skip, delay, or change medication
- treat silence or hesitation as completion
- request money, banking information, OTPs, passwords, or full NRIC
- create a hidden recurring schedule
- claim that emergency help or a caregiver has been dispatched when it has not

For an immediate emergency in Singapore, the interface states that a person should contact **995**. CareCall itself does not dispatch emergency services.

## Setup

```bash
npm install
npm run dev
npm run verify
```

Default tests are offline, require no credentials, and place no calls.

## Durable operations configuration

CareCall live calls fail closed unless both operator identity and durable storage are configured. The appointment-recovery migration path continues to use its existing access-code gate.

Required CareCall environment variables:

```text
CARECALL_SESSION_SECRET=<at least 32 random characters>
CARECALL_OPERATORS_JSON=[{"id":"mei-chen","name":"Mei Chen","role":"coordinator","access_code_sha256":"<sha256 hex>","senior_ids":["mdm-lim"]}]
UPSTASH_REDIS_REST_URL=<server-side Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<server-side standard token>
CARECALL_MAX_CALLS_PER_DAY=20
CARECALL_DATA_ENCRYPTION_KEY=<at least 32 random characters, stored server-side>
CRON_SECRET=<high-entropy scheduler bearer secret>
CARECALL_PUBLIC_BASE_URL=https://<production-host>
QSTASH_TOKEN=<server-side QStash publishing token>
QSTASH_URL=https://qstash-us-east-1.upstash.io
QSTASH_CURRENT_SIGNING_KEY=<QStash current signing key>
QSTASH_NEXT_SIGNING_KEY=<QStash next signing key>
```

Operator codes are stored only as SHA-256 hashes in the JSON configuration. Sessions are HMAC-signed, expire after 30 minutes, and are checked against the current operator configuration on every protected request. Redis, QStash, data-encryption, and scheduler credentials must remain server-side.

See the [CareCall environment variable reference](../../../docs/agent-gallery/carecall-environment-variables.md) for each variable's consumer, safe setup method, renewal trigger, and rotation procedure. It deliberately contains no deployment values.

## Queue and recurring schedule operation

Manual and recurring authorizations both create encrypted durable call jobs. QStash delivers a signed, minimal message containing only the job ID to `/api/carecall/worker`; the worker verifies both current and next signing keys before reading the protected job from Redis. Set `QSTASH_URL` to the origin for the same region that issued the token and signing keys; the US origin is `https://qstash-us-east-1.upstash.io`, while omitting the variable uses the SDK's EU default.

The queue permits one ongoing CareCall at a time. If the active lease is occupied, later calls remain queued. Manual authorization expires after 30 minutes rather than waiting indefinitely. When provider status becomes terminal, a delayed status message records the conservative outcome, releases the lease, and wakes the next job. Delivery retries cannot create another phone call because the call request still passes through the durable request claim.

The Calls destination reads a protected, senior-scoped operational list that refreshes every five seconds. It shows waiting, active, completed, cancelled, and needs-review records with provider timing when available. Provider duration is preferred; an observed start-to-completion duration is identified as a fallback. Full phone numbers, encrypted phone data, access codes, caregiver instructions, and transcripts are never returned by the list endpoint or rendered in the console.

Immediately before dialing, the worker rechecks:

1. operator and senior scope
2. recurring schedule status and review period
3. the senior's permitted Singapore call window
4. daily spending and durable idempotency limits
5. cancellation and the stable occurrence key

The Hobby-compatible Vercel cron in `vercel.json` runs once daily and invokes `/api/carecall/scheduler` with `CRON_SECRET`. It is a reconciliation safety net only: it repairs missing status checks, identifies missing jobs, expires reviews, and sends missed occurrences to human review. It never places a late call. Exact-time execution comes from QStash delayed delivery rather than the daily cron.

Before a controlled pilot, run the protected configuration and operations preflight from a trusted terminal. It reads no secret values and places no call:

```sh
npm run preflight
```

Set `CARECALL_PUBLIC_BASE_URL` and `CRON_SECRET` in the terminal environment using the same secret source as the deployment. The response reports configuration booleans plus PII-free queue depth, active-call state, queue age, review counts, grouped reasons, and operational alerts. See the [pilot runbook](../../../docs/agent-gallery/carecall-pilot-runbook.md) for the acceptance matrix, accessibility gate, controlled-call procedure, and stop conditions, and the [Phase 6 verification record](../../../docs/agent-gallery/carecall-phase6-verification.md) for completed local evidence and remaining credentialed checks.

An expired review date, revoked operator, invalid encrypted record, missed occurrence, or failed call start moves the job and schedule to `needs_review`. Queued manual calls can be cancelled before they start. Schedule pause invalidates its queued occurrence; cancellation also removes stored phone ciphertext and requires new authorization. An ongoing provider call cannot be recalled.

## UI structure

```text
src/
├── App.tsx                    responsive CareCall application shell
├── carecall/
│   ├── fixtures.ts           fictional Singapore care records
│   ├── call-operations.ts    call-list contracts and state/time presentation
│   └── types.ts              UI-domain contracts
├── components/
│   ├── CallPreviewSheet.tsx  masked, no-side-effect dry-run preview
│   ├── CareCallExecutionSheet.tsx authorization, live polling, and result
│   ├── ScheduleActivationSheet.tsx explicit recurring authorization
│   ├── CarePrimitives.tsx    status, avatar, and routine components
│   └── Icon.tsx              dependency-free interface icons
├── screens-care/
│   ├── Today.tsx
│   ├── Seniors.tsx
│   ├── CareRoutines.tsx
│   ├── Calls.tsx             protected queue, active-call, and history console
│   ├── NeedsAttention.tsx
│   └── Settings.tsx
└── styles.css                semantic, adaptive utility design system
```

The older `screens/` and `workflows/appointment-recovery/` directories remain temporarily as a migration reference. The reusable `src/calle/` adapter still imports no workflow-specific code; the layering rule is enforced by `test/layering.test.ts`.

## Next implementation milestone

Phase 5B queue hardening, Phase 6A automated pilot safeguards, and Phase 6A.2 operational visibility are implemented. Credentialed Phase 6B staging and consenting live-call verification remain:

1. Repeat the queue acceptance matrix against deployed Redis/QStash and verify each transition in the Calls console.
2. Verify one consenting end-to-end English call from the deployed interface with durable operations configured.
3. Run controlled recurring-call acceptance tests covering pause, cancellation, review expiry, host overlap, and provider failure.
4. Add organisation-managed operator provisioning, credential rotation, schedule listings, and encryption-key rotation instead of environment JSON.

## Credentials and live-call safety

The existing API routes read CALL-E credentials only from server-side environment variables. Tokens and confirmation values must never enter browser bundles, repository files, screenshots, transcripts, or chat.

The live CareCall path requires:

- a server-checked operator identity with senior-scoped authorization
- an E.164 phone number, masked outside necessary input
- explicit authority to contact the senior
- a one-call or explicit recurring authorization gate after preview
- immediate submit disabling and durable duplicate prevention with stable request keys
- a shared durable call queue with one active-call lease and signed worker delivery
- clear pause and terminal cancellation for every recurring routine
- no credentials or live calls in default tests
