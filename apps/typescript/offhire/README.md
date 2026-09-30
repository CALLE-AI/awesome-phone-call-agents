# OffHire: confirm the rental cutoff, track pickup separately

A TypeScript reference for one easily missed equipment-rental handoff: the site requests collection, but still needs the rental desk's effective off-rent date, time and confirmation reference. CALL-E asks those questions; OffHire checks the transcript before displaying a supplier-reported cutoff. A pickup booking remains a separate result.

Built by **Shivam Gupta**. This standalone CLI shares its pure evidence engine with the [OffHire application source](https://github.com/shi1720/OffHire). The [public rehearsal](https://offhire.web.app) is available without an account; this contribution also runs independently of the hosted app. No live-call proof, real supplier verification or recovered money is claimed here.

## Quick start: no account or phone call

Requires Node.js 22.13+ and npm. From this directory:

```sh
npm ci
npm run demo
npm test
npm run typecheck
```

`npm run cli` also defaults to the synthetic demonstration. Installation downloads public dependencies; demo execution makes no network requests.

| Synthetic scenario | Billing | Collection |
| --- | --- | --- |
| Explicit confirmation | Supplier-reported cutoff | Scheduled |
| Pickup booked, billing unclear | Unconfirmed; review | Scheduled |
| Later correction | Unconfirmed; review | Unknown/review |

## Reusable parts

- `src/core/call-plan.ts`: a one-asset CALL-E task and supported JSON result schema.
- `src/core/decision.ts` and `evidence.ts`: strict result validation, complete callee-turn evidence, identifier boundaries, cutoff/timezone checks, affirmative readback, later corrections, and independently quoted pickup status/window.
- `src/run.ts`: official `@call-e/calle@0.7.0` SDK runtime, private persisted requests and receipts, stable idempotency, a local process lock, and deliberate uncertainty recovery.
- `test/`: 79 no-call tests including evidence adversaries, authorization, actual SDK serialization through fake transport, and identical-body/key replay.

Provider `completed` or `taskCompleted` is not a billing confirmation. `reported_off_rent` means the supplier statement passes the small accepted English grammar; it does not certify accounting changes. Unknown/unsupported phrasing, missing evidence and contradictions remain for human review. No invoice, refund, contract or equipment action is performed.

## Intentional owned-phone rehearsal

The CLI's live path is limited to **fictional rental conversations with an owned number or a person who explicitly agreed to play the rental desk**. `isTest` must be `true`. The exported core can support a separate business application with its own controls. There is no default live destination.

```sh
cp examples/rental.example.json rental.private.json
cp .env.example .env
```

Edit `rental.private.json`: enter the consenting phone in E.164 format, supported region/timezone, current request date, and `authorizedContact:true`. Keep the equipment/contract fictional. In `.env`, set:

- `CALLE_API_KEY` from [CALL-E API Keys](https://dashboard.heycall-e.com/account/api-keys).
- `OFFHIRE_LIVE_ENABLED=true` and `OFFHIRE_CONTACT_AUTHORIZED=true` only for the agreed test.
- `OFFHIRE_AUTHORIZED_PHONE` equal to the exact saved destination.
- `OFFHIRE_AUTHORIZATION_EXPIRES_AT` as a short future ISO timestamp.

Prepare a concrete plan without calling:

```sh
npm run cli -- preview --input rental.private.json --state .state/rehearsal-001
```

Read the private `.state/rehearsal-001/plan.json`, which contains the full task, destination and schema. The console masks the phone and prints the approval digest. The plan expires in 15 minutes. To start that exact reviewed operation:

```sh
node --env-file=.env --import tsx src/cli.ts start \
  --state .state/rehearsal-001 --approve <printed-plan-digest>
```

**Start can place a real outbound call and consume CALL-E credits.** The agent introduces itself as an AI assistant conducting a fictional test. The recipient can decline or hang up. It asks separately about billing cutoff/reference and collection; it cannot accept fees or change an actual contract. Do not discuss secrets, OTPs, payments, emergency incidents, or medical/legal/financial advice.

After allowing time for the conversation and provider finalization, retrieve the same call:

```sh
node --env-file=.env --import tsx src/cli.ts status --state .state/rehearsal-001
```

Each invocation is one GET, not a background polling loop. The console shows masked status; full result/transcript is saved privately in `run.json`. Unresolved extraction stays unresolved in the demo. Publish only redacted excerpts with the participant's consent.

The provider host is fixed to `https://api.heycall-e.com`; credentials cannot be routed to an arbitrary base URL. Coverage, provider attempts, duration, account limits and charges remain subject to CALL-E. The prompt asks for a short call but does not enforce a duration/cost cap. See [Calls](https://docs.heycall-e.com/calls) and [regions](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages).

## Recovery, cancellation and local state

One state directory is one logical call. **Never delete, duplicate or replace it to retry an uncertain operation.** Do not create another directory for the same unresolved rental test. The filesystem lock serializes commands within a directory; it is not distributed or account-wide. Operate one live rehearsal at a time.

| State | Next action |
| --- | --- |
| `prepared` | Review/start, or cancel locally before submission. |
| `dispatching` after crash / `dispatch_uncertain` | Reconcile the same operation; no automatic retry occurs. |
| Saved ID, `queued` / `in_progress` | `status`, even after authorization expiry; GET only. |
| `completed` / `failed` / `canceled` | Inspect the receipt. The run cannot be submitted again. |

While both original authorization and plan remain valid, explicitly recover a lost create response:

```sh
node --env-file=.env --import tsx src/cli.ts recover \
  --state .state/rehearsal-001 --approve <same-plan-digest>
```

Recovery sends the frozen original request/key. It can return the previously accepted call, or create the originally authorized call if the first request never arrived. After expiry, replay is blocked: reconcile through provider support/dashboard before considering a separately authorized operation. A saved Call ID always uses GET. [Provider recovery contract](https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response)

```sh
npm run cli -- cancel --state .state/rehearsal-001
```

Cancel affects only an unsubmitted plan. **The Calls API cannot cancel an accepted call.** Ctrl+C, timeout, closing the terminal or deleting state does not stop a remote call. Provider account/support controls may be necessary. There are no recurring schedules, automatic redials, additional recipients or downstream financial writes.

After a crash leaves `.lock`, ensure the old process has stopped before removing only that lock:

```sh
npm run cli -- unlock --state .state/rehearsal-001 --confirm-process-stopped
npm run cli -- inspect --state .state/rehearsal-001
```

Unlocking creates/cancels nothing and does not change the request. Never unlock a running process. Resume through saved-ID retrieval or explicit same-key recovery.

## Privacy and limits

`.env`, `*.private.json`, `.state/` and dependencies are ignored by Git. New state files are `0600` and new directories `0700` on Unix. Receipts contain the full destination, task and transcript, but never the API key. Use a private local folder. Retain uncertain records for recovery; delete terminal records according to your local retention policy and never reuse a deleted run identity.

This is a local reference, not a public calling endpoint, SDK replacement or production guarantee. It has no hosted authentication, multi-tenant database, background worker or webhook receiver. English evidence checks are heuristic and advisory. Invoice approval, contract interpretation, disputes/refunds and physical equipment handling remain human responsibilities. Tests establish local behavior and the SDK boundary with fake responses, not live telephony quality or commercial outcomes.

License: MIT. Core source and standalone CLI by Shivam Gupta; [full application repository](https://github.com/shi1720/OffHire).
