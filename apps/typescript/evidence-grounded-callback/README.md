# Evidence-grounded callback

This focused TypeScript app compiles reviewed business facts and a positive callback-consent receipt into a guarded CALL-E MCP workflow. It prevents unreviewed website claims from silently becoming call instructions and separates no-call preview, CALL-E planning, and live dispatch.

It is useful when an AI agent has already collected source evidence and needs to make one requested business callback without inventing prices, policy, availability, or consent.

## Workflow

1. Supply an evidence packet with an E.164 recipient, positive consent, objective, and candidate facts.
2. Mark only owner-reviewed facts as `approved`.
3. Run `preview`; this is local and contacts neither CALL-E nor the recipient.
4. Run `plan`; this invokes CALL-E's `plan_call` MCP tool but does not place a call.
5. A host may import `runPlan()` only after adding its own server-side live enablement and exact action-time approval. The included CLI intentionally does not expose dispatch.

## Setup

Requires Node.js 22 or newer. Install and authenticate the official CALL-E CLI first, then install this app's development dependencies:

```bash
npm install
calle auth login
calle auth status --no-telemetry --json
```

Preview the fictional example:

```bash
npm run preview
```

Create a CALL-E plan without dialing:

```bash
node --import tsx src/cli.ts plan --input examples/callback.example.json
```

Planning creates external CALL-E state but does not place a call. Do not paste confirmation tokens into logs, browser code, screenshots, issues, or pull requests.

## Inputs and outputs

Every approved fact must carry an HTTPS source URL, a source quote, and the SHA-256 hash of the source artifact. The compiler emits a stable workflow hash, idempotency key, masked phone number, exact approval phrase, bounded call task, and `plan_call` arguments.

The task instructs CALL-E to disclose the requested callback, honor opt-out immediately, abstain when evidence is absent, and avoid payment, health, government-ID, authentication, and account-secret data.

## Side effects and cancellation

- `preview`: no network or phone side effect.
- `plan`: creates a CALL-E plan only; it never invokes `run_call`.
- `runPlan()`: can place one real call. It refuses unless `ALLOW_LIVE_CALLS=1`, the plan is unexpired and unused, and the supplied approval phrase matches the recipient's last four digits. It consumes the plan before crossing the network boundary, so an ambiguous failure requires status reconciliation instead of an automatic retry.
- There is no recurrence or hidden scheduler. To cancel before dispatch, discard the plan and leave `ALLOW_LIVE_CALLS` unset. After dispatch, use CALL-E's run controls and do not retry automatically.

Only call numbers you own or are authorized to contact. Do not use this example for emergency, medical, legal, financial, or high-impact decisions without domain-specific review and controls.

## Verification

Tests use an injected fake CALL-E runner and never make a network request or phone call:

```bash
npm run verify
```

The tests prove deterministic custody hashes, consent and evidence refusal, exclusion of unapproved claims, no-call planning, and fail-closed dispatch gates.
