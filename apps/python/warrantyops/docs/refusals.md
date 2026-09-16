# Refusals

Generated from ``warrantyops/refusals_catalog.py`` — regenerate with
``make docs`` (``python -m warrantyops --generate-docs``). Do not
edit by hand; the tests assert this file matches the catalog, and
the catalog asserts it matches the enums.

Every refusal is a named member of an enum, never free text. A
refusal never reaches a later gate, and nothing later rescues an
earlier refusal. The last column answers one operational question:
does making this right require a **new source version** before a
new attempt may even be considered? ``yes`` means the idempotency
key is bound to a version that is now spent, moved or superseded.

## Envelope gate (`ENVELOPE`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `MISSING_SOURCE_PLATFORM` | The claim names no source platform, so no version reader and no adapter can be bound. | Fix the claim extraction; the envelope is not a basis for any step. | no |
| `MISSING_SOURCE_CLAIM_ID` | No claim identifier to anchor the idempotency key or the write-back to. | Fix the claim extraction. | no |
| `MISSING_SOURCE_VERSION` | Without a version the pre-call re-read and the write-back guard cannot work. | Fix the claim extraction. | no |
| `MISSING_EXCEPTION_STATUS` | The residual-necessity gate has no status to test against the exhaustion manifest. | Fix the claim extraction. | no |
| `MISSING_SUBMITTED_AT` | Claim age cannot be computed, so the economics gate cannot run. | Fix the claim extraction. | no |
| `SUBMITTED_IN_THE_FUTURE` | A claim dated after the run date is malformed or the clock is wrong. | Fix the extraction or the clock; never proceed on a future-dated claim. | no |
| `MISSING_ORGANIZATION` | The disclosure task cannot name the caller organization. | Fix the claim extraction. | no |
| `MISSING_ACCOUNT_CONTEXT` | The counterparty cannot be told which account the call concerns. | Fix the claim extraction. | no |
| `INVALID_PHONE` | The counterparty number is not a valid E.164 address. | Fix the number in the source system. | no |
| `MISSING_POLICY_ID` | No economic policy can be looked up for the claim. | Fix the claim extraction or add the policy. | no |
| `VALUE_WITHOUT_CURRENCY` | A claim value with no currency cannot be compared against the minimum. | Fix the claim extraction. | no |
| `CURRENCY_WITHOUT_VALUE` | A currency with no value cannot be compared against the minimum. | Fix the claim extraction. | no |
| `INVALID_CLAIM_VALUE` | The claim value is not a usable amount. | Fix the claim extraction. | no |
| `REMEDY_MISSING_CHANNEL` | A claimed remedy names no channel, so the exhaustion manifest cannot be checked against it. | Fix the remedies on the claim. | no |
| `REMEDY_MISSING_OUTCOME` | A claimed remedy records no outcome, so the exhaustion manifest cannot be checked against it. | Fix the remedies on the claim. | no |
| `MISSING_EXHAUSTION_MANIFEST` | No structured record that the ordinary routes were attempted. Without it the call is not proven residual. | The claim adapter layer supplies the manifest for this source version. | no |
| `EXHAUSTION_MANIFEST_INCOMPLETE` | The manifest is not a complete record for this source version: no routes, a route with no outcome, no stated information gap, or bound to a different version. | The claim adapter layer repairs the manifest for this exact source version. | no |

## Residual-necessity gate (`RESIDUAL_NECESSITY`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `ORDINARY_ROUTE_NOT_EXHAUSTED` | An ordinary route exists that has not been tried to completion. The phone is not first. | Exhaust the listed ordinary routes in the manifest before reconsidering a call. | no |
| `SOURCE_ALREADY_ANSWERS` | The source record already contains the answer the call would ask for. | Read the answer from the source; no call is residual. | no |

## Source-state gate (`SOURCE_STATE`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `SOURCE_CHANGED` | The authoritative source version no longer matches the envelope's version. | Re-extract the claim at its new version; every downstream identity is version-bound. | yes |
| `SOURCE_RECHECK_UNAVAILABLE` | No version reader was supplied, so the live version could not be re-read before dialing. | Supply a reader; a stale envelope is never dialed as if current. | no |

## Economics gate (`ECONOMICS`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `POLICY_NOT_FOUND` | No economic policy exists for the claim's policy id. | Add the policy or fix the policy id. | no |
| `CURRENCY_MISMATCH` | The claim currency differs from the policy's currency. | Fix the policy book or the claim extraction. | no |
| `CLAIM_VALUE_UNKNOWN` | The claim value is unknown, so worth-vs-cost cannot be computed. | Establish the value in the source system, or set a policy for unknown values. | no |
| `BELOW_MINIMUM_VALUE` | The claim value is below the policy's minimum for a call. | Handle through ordinary routes; the call does not clear the organization's economics. | no |
| `CLAIM_TOO_OLD` | The claim is older than the policy's maximum age for a call. | Handle through ordinary routes. | no |
| `CALL_COST_UNKNOWN` | The cost of the call is unknown, so worth-vs-cost cannot be computed. | Set the call cost in the policy book; an unknown cost is never treated as free. | no |
| `NOT_WORTH_PURSUING` | The expected recovery does not clear the cost of the call under the policy's arithmetic. | Handle through ordinary routes. | no |

## Authorization gate (`AUTHORIZATION`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `INVALID_E164` | The authorized recipient is not a valid E.164 number. | Fix the authorization record. | no |
| `MISSING_PURPOSE` | The authorization record names no purpose. | Fix the authorization record. | no |
| `PURPOSE_MISMATCH` | The record's purpose does not match the purpose of this run. | Use an authorization whose purpose matches, or fix the record. | no |
| `EXPIRED` | The authorization record has expired. | Obtain a current authorization. | no |
| `NOT_YET_VALID` | The authorization record is not valid yet. | Wait for its validity window, or fix the record. | no |
| `MISSING_RECORD_REFERENCE` | The decision carries no reference to the authorization record it was made from. | Fix the authorization record. | no |
| `RECIPIENT_NOT_ALLOWLISTED` | The recipient is not on the configured allowlist for live calling. | Add the recipient to the allowlist through the governed process, or use the fake provider. | no |
| `AUTHORIZED_RECIPIENT_MISMATCH` | The authorization names a number other than this claim's counterparty. An authorization is for one destination. | Use the authorization that belongs to this claim's counterparty. | no |

## Disclosure gate (`DISCLOSURE`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `PROHIBITED_TASK_TEXT` | The composed task text instructs a prohibited action: adjudicate, approve, resubmit, negotiate, settle, retry or promise. | Fix the disclosure payload that produced the text; an inquiry call may ask, not act. | no |

## Attempt-ledger gate (`ATTEMPT_LEDGER`)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `ATTEMPT_LEDGER_UNAVAILABLE` | No attempt ledger was supplied, or the ledger could not be opened or written. Without a reservation no call may be placed. | Restore the ledger (path, permissions, schema) and re-run; nothing was dialed. | no |
| `DUPLICATE_CALL_SUPPRESSED` | This claim version was already attempted; the reservation exists in whatever state it ended in. | Human reconciliation of the earlier attempt; a new attempt needs a new source version and therefore a new key. | yes |
| `IDEMPOTENCY_CONFLICT` | The key was already reserved for a different request body. | Investigate the collision; never silently replay a key onto a different request. | yes |
| `LEDGER_NOT_DURABLE` | A live-capable provider was paired with a non-durable (in-memory) ledger. | Use a durable SQLite ledger for any live-capable provider. | no |
| `LEDGER_PATH_MISSING` | No ledger database path was configured. | Configure the ledger path outside the repository. | no |
| `LEDGER_PATH_INSIDE_REPOSITORY` | The ledger path resolves inside the repository; call data must never enter git. | Move the ledger outside the repository. | no |

## Identifier grounding (inside derivation, not a gate)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `NO_VALUE` | The counterparty stated no claim, case or credit reference at all. | The field stays absent; the receipt records the absence. | no |
| `NO_READBACK` | A reference was stated but never read back digit by digit. | Treat the reference as unconfirmed; only a completed read-back exchange confirms it. | no |
| `NO_CONFIRMATION_VALUE` | The read-back was attempted but no value to confirm could be isolated. | Treat the reference as unconfirmed. | no |
| `QUOTE_MISSING` | No confirmation quote exists in the transcript. | Treat the reference as unconfirmed. | no |
| `QUOTE_TOO_SHORT` | The candidate confirmation is not a whole answer (a bare digit fragment or filler). | Treat the reference as unconfirmed; fragments never confirm. | no |
| `QUOTE_NOT_AFFIRMATIVE` | The reply to the read-back is not an affirmation. | Treat the reference as unconfirmed. | no |
| `QUOTE_NEGATED` | The reply to the read-back denies the value just read. | Treat the reference as unconfirmed; a denial is not a correction either. | no |
| `QUOTE_HEDGED` | The reply to the read-back hedges or defers to a record the speaker cannot see. | Treat the reference as unconfirmed. | no |
| `TRANSCRIPT_UNAVAILABLE` | No transcript exists to ground the exchange in. | The reference cannot be confirmed from this attempt. | no |
| `QUOTE_NOT_IN_COUNTERPARTY_TURN` | The confirmation does not come from the counterparty's own turn. | Treat the reference as unconfirmed; the agent confirming itself confirms nothing. | no |
| `IDENTIFIER_NOT_IN_EXCHANGE` | The confirmation does not belong to the exchange that carried the read-back of this value. | Treat the reference as unconfirmed. | no |
| `AMBIGUOUS_EXCHANGE` | More than one exchange could be the confirming one. | Treat the reference as unconfirmed; ambiguity never resolves in favor of confirmation. | no |
| `PATTERN_MISMATCH` | The read-back value does not match the expected reference pattern. | Treat the reference as unconfirmed. | no |
| `REFERENCE_EVIDENCE_UNGROUNDED` | The claimed reference is not grounded in an exact transcript span. | Treat the reference as unconfirmed; only an exact span or a completed exchange grounds a field. | no |

## Configuration (before any gate)

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `LIVE_NOT_ENABLED` | The live-call kill switch (CALLE_LIVE_CALLS_ENABLED) is not set. | Set the environment variable if — and only if — a live call is intended and authorized. | no |
| `MISSING_API_KEY` | No CALLE_API_KEY in the environment for a live-capable provider. | Provide the key through the environment; never on a command line or in a file in git. | no |
| `UNOFFICIAL_ORIGIN` | The configured API origin is not the official CALL-E origin. | Fix the origin configuration. | no |
| `ARTIFACT_DIR_MISSING` | No private artifact directory is configured for raw call artifacts. | Configure the directory outside the repository. | no |
| `ARTIFACT_DIR_INSIDE_REPOSITORY` | The private artifact directory resolves inside the repository. | Move it outside the repository; raw artifacts never enter git. | no |

## Review binding

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `NOT_APPROVED` | The human decision was REFUSE or RETURN_TO_DIGITAL, which never authorize a write. | Record the safe non-write; no mutation happens. | no |
| `MISSING_REVIEWER` | The decision names no reviewer. | Re-record the decision with a reviewer. | no |
| `NOT_TIMEZONE_AWARE` | The decision timestamp carries no timezone. | Re-record the decision with an aware timestamp. | no |
| `NOT_BOUND_TO_PACKET` | The decision was recorded against a different review id than this packet's. | Re-review this packet; a stale approval is not an approval. | no |
| `OPERATOR_MISSING` | No host-derived operator identity was recorded with the decision. | Re-record the decision with the operator principal. | no |
| `PACKET_HASH_MISMATCH` | The decision was recorded against a different packet body than the one being written. | Re-review the current packet. | no |

## Write-back guard

| Refusal | Meaning | Next action | New source version needed? |
|---|---|---|---|
| `NO_BUSINESS_RESULT` | The outcome carries no write-back-eligible business result. | Nothing to write; the receipt is the record. | no |
| `NOT_REVIEWED` | No approved, bound human decision exists for this outcome. | Route the packet through review. | no |
| `SOURCE_CHANGED` | The source version moved between the call and the write. The write would land on a different record than the one asked about. | Re-run against the new version from the envelope gate onward. | yes |
| `REVIEW_CONFLICT` | A note already exists under this write's identity, approved by a different review. Two approvals of one write is one too many. | A human resolves which review governs the note; this code does not decide. | no |
