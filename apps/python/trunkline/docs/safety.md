# Safety notes

Trunkline places real phone calls to health plans and handles patient identifiers. This document states what it will and will not do, and where each rule is enforced.

## Who is called

Trunkline calls **health plan provider-services lines**, which are published business numbers staffed to take exactly these questions. It does not call patients. That is a product boundary, not a configuration option: there is no patient-facing workflow, and the disclosure envelopes carry no patient contact details.

The distinction matters legally as well as ethically. The FCC's February 2024 declaratory ruling treats AI-generated voices as artificial under the TCPA, which governs calls to consumers. A provider's billing office calling its payer about a submitted claim is business-to-business administrative contact and does not sit in that regime the same way.

## Explicit intent

No call happens without a person asking for it.

- `preview` and `fixture` modes place no call at all and need no credentials.
- `live` mode requires `--yes` on an interactive run **and** a written authorization record for the payer, naming the exact destination, an expiry date, and a maximum number of calls.
- An unattended scheduled run carries no `--yes`. The authorization record is the operator's separately written consent, and it expires and runs out on its own.

## Destinations

- Numbers must be full E.164 and must match the payer record's region.
- North American numbers are checked against NANP rules; premium-rate area codes are refused.
- A live run refuses if the payer's number no longer matches the authorized destination character for character.
- Every number is masked wherever it is printed, stored, or rendered: `+12*******42`.

## Patient identifiers

- Identifiers live in `data/vault/`, one owner-readable file per patient reference. The ledger stores only the reference.
- `policy.DISCLOSURE_ENVELOPES` names the only fields each workflow may disclose. Eligibility discloses less than claim status, because it needs less.
- `policy.NEVER_DISCLOSE` fields are dropped by the resolver even if an envelope names one, and `plan.build_plan` refuses to return a task whose text contains one.
- Transcripts are scrubbed between verification and persistence.
- `trunkline vault-check` walks every file outside the vault and looks for every identifier in it. The test suite runs the same check after a call that spoke the member id aloud.

## What the agent may never do on the call

The full list is in `policy.AGENT_BOUNDARIES` and is appended verbatim to every task. In summary: no appeal filed or withdrawn, no amount accepted or disputed, no claim changed, no Social Security number or full address given, no clinical discussion, no guessing, and no argument that a claim is owed.

If a representative will not proceed without something Trunkline does not disclose, the agent records what the billing office must supply and ends the call.

## Disclosure

Every call opens by stating that the caller is an AI assistant calling for the provider's billing office, and that the call may be recorded. Twelve states require all-party consent to record; Trunkline discloses in every state rather than tracking each line's location.

## Recurring work and cancellation

Trunkline runs no scheduler. A host scheduler runs one cycle; the suppression reasons decide whether a call happens. There is no provider-side recurrence, so there is no hidden schedule to discover later.

Stopping is immediate and has three independent switches:

1. `trunkline kill-switch on` refuses every call while the file exists.
2. `trunkline revoke --payer <id>` deletes the authorization and live runs refuse.
3. Removing the scheduler entry stops future cycles.

A call already accepted by CALL-E completes; `trunkline reconcile` folds the result in rather than leaving a claim stuck.

## Duplicate calls

Claims are marked `pending_call` and written to disk before the request leaves the machine, with a fresh idempotency key sent as `Idempotency-Key`. If no usable submission response comes back, the call is marked `submission_unknown` and its claims stay in `pending_reconciliation`. The live batch halts and all later live calls are refused until `reconcile` resolves the call against CALL-E or an operator clears it after confirming in the dashboard that no call exists.

## Medical, legal, financial, and emergency boundaries

Trunkline is an administrative product. It discusses claim adjudication with a claims representative and nothing else.

- **Medical:** no diagnosis, treatment, clinical advice, or discussion of care. Prior authorization is handled as a status question, never a clinical one.
- **Legal:** no appeals filed, no legal position taken, no mention of lawyers or regulators.
- **Financial:** no amount accepted, waived, negotiated, or disputed. No payment instrument is ever given.
- **Emergency:** Trunkline is not for urgent clinical situations. It calls billing departments during business hours about claims that have already been adjudicated.

## Credentials

The CALL-E key is read from the environment or a local `.env`, never committed, and sent only to `https://api.heycall-e.com`. A base URL pointing anywhere else is refused, except a loopback address while running in fixture mode. Redirects are followed only when they remain on the already approved origin, and provider error response bodies are never copied into exceptions. Nothing else reads the key: the console cannot place live calls and has no access to it.

Phone numbers in provider summaries, transcript turns, structured values, findings, command output, exports, and console responses are masked. The destination still appears where an operator needs it, but only in the existing masked form.

The unauthenticated console is loopback only by default. When `TRUNKLINE_PUBLIC_DEMO=1` is enabled, it serves a fresh temporary ledger created from the committed fictional records instead of the configured data directory, and it rejects claim intake. The temporary copy is removed when the server stops, so a real operator ledger cannot be exposed through public demo mode.

## What is stored, and where

| Path | Contents |
| --- | --- |
| `data/ledger.json` | practices, payers, claims, call records, scrubbed transcripts. No identifiers |
| `data/vault/<ref>.json` | patient identifiers, owner-readable only |
| `data/authorizations/<payer>.json` | written live-call permission, with expiry and budget |
| `data/audit.log` | hash-chained append-only log of every planned, placed, and completed call |
| `data/KILL_SWITCH` | present means every call is refused |

Delete `data/` to remove everything. Deleting `data/vault/` alone leaves the ledger intact and unusable for further calls, which is the correct failure direction.
