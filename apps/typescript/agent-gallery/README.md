# CareCall SG

CareCall SG is a Singapore-focused care companion calling workspace for caregiver-authorized medication reminders, meal check-ins, self-reported outcomes, and human escalation.

> CareCall reminds seniors about approved everyday routines, records what they report, and directs exceptions to a human. It does not provide medical advice, verify adherence, dispatch emergency services, or replace human care.

The product and UI implementation source of truth is [`docs/agent-gallery/carecall-sg-ui-plan.md`](../../../docs/agent-gallery/carecall-sg-ui-plan.md).

## Current status

The CareCall single-call MVP foundation is implemented:

- responsive desktop and mobile navigation
- Today dashboard and care timeline
- fictional Singapore senior profiles
- medication and meal care routines
- visible pause and resume controls
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
- English-only live-call enforcement until other languages are verified
- accessible focus, reduced-motion, reduced-transparency, high-contrast, and dark-mode behavior

The interface uses fictional demo data and says so visibly. Pause and settings changes remain session-only demonstrations; no scheduler or digest is connected. When the durable operations environment is configured, live-call ownership, snapshots, outcomes, attention cases, acknowledgements, limits, and audits are stored server-side. The full phone number is entered only at the one-call authorization gate; durable snapshots retain only a masked suffix.

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
```

Operator codes are stored only as SHA-256 hashes in the JSON configuration. Sessions are HMAC-signed, expire after 30 minutes, and are checked against the current operator configuration on every protected request. The Redis standard token must remain server-side.

## UI structure

```text
src/
├── App.tsx                    responsive CareCall application shell
├── carecall/
│   ├── fixtures.ts           fictional Singapore care records
│   └── types.ts              UI-domain contracts
├── components/
│   ├── CallPreviewSheet.tsx  masked, no-side-effect dry-run preview
│   ├── CareCallExecutionSheet.tsx authorization, live polling, and result
│   ├── CarePrimitives.tsx    status, avatar, and routine components
│   └── Icon.tsx              dependency-free interface icons
├── screens-care/
│   ├── Today.tsx
│   ├── Seniors.tsx
│   ├── CareRoutines.tsx
│   ├── NeedsAttention.tsx
│   └── Settings.tsx
└── styles.css                semantic, adaptive utility design system
```

The older `screens/` and `workflows/appointment-recovery/` directories remain temporarily as a migration reference. The reusable `src/calle/` adapter still imports no workflow-specific code; the layering rule is enforced by `test/layering.test.ts`.

## Next implementation milestone

Operational hardening before recurring schedules or a care pilot:

1. Verify one consenting end-to-end English call from the deployed interface with durable operations configured.
2. Add host-owned recurrence only after pause, cancellation, quiet-hour, and retry behavior are durable.
3. Add organisation-managed operator provisioning and code rotation instead of environment JSON.

## Credentials and live-call safety

The existing API routes read CALL-E credentials only from server-side environment variables. Tokens and confirmation values must never enter browser bundles, repository files, screenshots, transcripts, or chat.

The live CareCall path requires:

- a server-checked operator access code (identity and senior-scoped authorization remain a hardening milestone)
- an E.164 phone number, masked outside necessary input
- explicit authority to contact the senior
- a one-call authorization gate after preview
- immediate submit disabling and an in-instance duplicate guard; durable duplicate prevention remains required before a pilot
- clear cancellation for every recurring routine
- no credentials or live calls in default tests
