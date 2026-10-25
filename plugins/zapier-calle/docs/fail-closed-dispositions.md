# Fail-closed dispositions for Calls v2

An accepted or completed phone call does not prove the business objective.
This integration makes that distinction explicit in
[`lib/disposition.js`](../lib/disposition.js) and keeps webhook verification,
transcript checks, and pre-call guards separate.

## Three independent signals

| Signal | Meaning | Insufficient to conclude |
| --- | --- | --- |
| `status` | Execution queued, in progress, completed, failed, or canceled. | That a person answered or agreed. |
| `call_outcome` | Telephone completed, no answer, busy, or declined; null before it is known or on technical failure/cancellation. | That the requested business facts were established. |
| `result_status` | Pending, available, unavailable, or not applicable. | That an available result is non-empty or useful. |

Read the same Call while `result_status` is pending. An unavailable result
with null result and error is final. Never turn that absence into a new dial.
See the [Calls contract](https://docs.heycall-e.com/api-reference/calls).

## Confirmation gate

A v2 business result is `confirmed` only when all of these hold:

1. Execution and telephone outcome are completed, with an available result
   and no technical error.
2. The result is a flat, non-empty scalar object. When the original schema is
   available, returned names/types/enums and required fields satisfy it.
3. Required business answers are usable; unknown-like or empty answers fail
   review. False and zero are values, not missing answers.
4. `business_confirmed` is exactly true. Its schema description defines the
   business decision; availability alone never supplies this flag.
5. `business_confirmed_quote` matches recorded recipient speech. Additional
   declared quote fields must also be present and grounded.
6. The full transcript is readable and contains no detected opt-out request.

The wait action retains the original schema. If that schema cannot be read,
it refuses to confirm. Search and static notifications lack the original
schema, so they check the returned fields and the mandatory confirmation
convention, but cannot detect an unrelated omitted business field. Use the
wait action or additional downstream validation when that distinction matters.

Quote matching is normalized substring matching, not semantic validation.
It rejects bot-only evidence and paraphrases that cannot be checked. English
denial or uncertainty cues in a positive confirmation quote require review;
other languages and subtler contradictions need human interpretation. It can
still match a short phrase by coincidence; ask for the full relevant sentence.
An explicit negative answer can be a valid collected fact, but it cannot
satisfy a schema whose business decision requires a positive answer.

## Routing

`confirmed` is the only potentially actionable disposition. `review_required`
covers empty/unavailable results, no-answer/busy/declined outcomes, unknown
answers, and missing evidence. `failed` means a technical error; `canceled`
means explicit cancellation. `outcome_unknown` means keep reconciling the
same request. Unknown interfaces, unreadable records, and verification
failures go to `needs_human`.

The pre-call guards produce `outside_calling_window`, `suppressed`, or
`retry_policy_blocked` before creating anything. Their lists/history are
caller-supplied, not maintained by the plugin. A malformed supplied policy
fails closed. Dry-run previews still report time/history decisions; a
suppressed number never receives a preview that implies it may be dialed.

The English opt-out phrase check reads recipient turns only and overrides
all business routing to `blocked_compliance`. Other languages and uncommon
wording need manual review. Do not treat a false detector flag as proof of
consent. Update the caller's own suppression record before further contact.

`lead_state` is a coarse routing label: confirmed maps to `qualified`,
pre-call compliance blocks and opt-out map to `blocked_compliance`, and
other outcomes map to `needs_human`. It does not assert sales qualification.

## Trust and duplicate delivery

A webhook body names a Call; it does not authenticate the business result.
Both webhook surfaces retrieve that Call with the connection's API key,
check its API resource ID and interface, and classify the authenticated
record. A Billing telephone ID is never used in a resource path.

A resumable action also rejects a notification for a different waiting
Call. A static URL has no durable deduplication state, so its outputs are
always non-actionable, even after a successful lookup. Freshness comes from
CALL-E's completion time, not the notification's timestamp. An old success
is downgraded after 15 minutes. Re-read with Find Call Result before a
consequential write and deduplicate that write by API Call ID.

## Uncertain creation and recovery

Save the original logical input and reuse its key. The same accepted request
can be replayed after completion, failure, or cancellation without another
dial. Do not add inferred region/locale values to a replay that omitted them.

Zapier supplies one callback URL per execution. A retried execution must
retain it. If only that URL changes, the stable business-payload key causes
CALL-E to reject the changed request with a conflict. A new key would risk
another call, so it is not a recovery strategy.

A definitive `input_incomplete` rejection asks for corrected input and
creates no Call. A timeout or lost response does not establish rejection:
retry the original request/key, then reconcile its returned API ID.

A separate Delay → Find Call Result path can enforce a wait limit. Pending
results beyond that limit require a human; the plugin never automatically
redials an unavailable, declined, or uncertain result.

## Legacy work

Historical `call_task` notifications and explicitly selected v1 lookups keep
the legacy classifier and output shape, including `result_invalid` and
confidence fields. New v2 results do not contain those provider fields or
attempt counts. No confidence score or ring count is invented to preserve an
old filter. Keep accepted legacy work on its original receiver until it drains.

## Verification

The suite covers available `{}`, final unavailable with no error, delayed
extraction after completed execution, cancellation, technical failure,
no-answer/busy/declined, schema violations, missing/bot-only evidence,
opt-out, forged notifications, wrong IDs/interfaces, duplicate deliveries,
changed callback conflicts, exact replay, and legacy reads. The SDK tester
runs the app middleware and resume handlers against the fake service.
Hosted webhook delivery and downstream application writes require a separate
authorized test Zap before release.
