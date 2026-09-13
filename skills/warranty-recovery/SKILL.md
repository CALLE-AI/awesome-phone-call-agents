---
name: warranty-recovery
description: Resolve a residual post-submission warranty-claim exception with one authorized outbound phone call. The call asks the counterparty for the claim's current status, their stated reason for the rejection, return or non-payment, the correction or documents they need, any deadline, and a claim, case or credit reference that is only asserted after the representative confirmed a read-back. Use when a submitted claim is rejected, returned, unpaid or stalled, the portal and documented-code route produced no actionable reason or next step, and the next move is a call to the manufacturer, distributor or service provider.
---

# Warranty claim exception call

A residual claim exception is what is left when a legitimate submitted claim
is rejected, returned, unpaid or stalled and the portal, the documented
reject code and the written follow-up have not produced an actionable reason
or next step. Somebody has to phone the OEM or distributor, ask what holds
the claim and what would move it, and come back with something an operator
can act on. This skill packages that call so that what comes back is
checkable.

The workflow's hard rule is that the result is allowed to be empty. An
unknown that is labelled unknown is worth more than a confident answer
nobody said.

## When to use this

Use it when all of the following hold:

- a claim was actually submitted, and self-service channels have already
  been exhausted on it: portal status checked, documented code looked up,
  written follow-up sent;
- the source record still does not state the next step;
- the counterparty is a business you have an authorization basis to call;
- the outcome the caller needs is the counterparty-stated status, reason,
  required correction and any reference — not a decision.

Do not use it to adjudicate coverage, dispute or negotiate a claim,
resubmit, or call a consumer. It asks questions and records answers.

## Before the call

1. Establish the authorization basis. Read `references/safety.md` for the
   four bases this workflow accepts and what each requires. No basis, no
   call.
2. Snapshot the source claim: platform, claim id, immutable source version,
   exception status, documented code and reason, the ordinary remedies
   already attempted, and the caller's account context. The snapshot is
   what every later check compares against, and a write-back only ever
   happens against an unchanged version.
3. Check the gates in order: residual necessity (the source must not already
   answer the question), the organization's own economic policy (supplied
   facts only, never an estimate), then authorization.
4. Derive the idempotency key from the authorization record, the source
   claim and version, and the contract version — never from the attempt.
   A retry must reuse the key; a deliberate re-check must not.

## The call

Ask for the counterparty's own statements, and accept that any of them may
be unavailable:

- where the claim stands in their system right now, and the words that
  establish it;
- the reason they give for the hold, rejection, return or non-payment;
- the correction or documents they need, any deadline, and where to
  escalate if nothing moves;
- the single next step they ask for.

If a claim, case or credit reference is given, read it back digit by digit
and ask them to confirm before ending the call. See
`references/identifier-confirmation.md` for why this is the one part of the
workflow that is not optional.

## After the call

Map what was said onto the contract in `references/result-contract.md`.
Three rules decide most cases:

- A hedge is not a status. "It should probably go through next week" is
  `claim_status: UNKNOWN`.
- A call that did not complete has no business outcome. No answer is not
  "rejected".
- A reference the representative never confirmed does not become an
  actionable identifier. It is kept as an unconfirmed candidate for human
  review instead of being asserted.

Read `references/calle-platform-notes.md` before relying on any provider
field: it records what the CALL-E documentation guarantees and, more
usefully, what it explicitly does not.

## Worked cases

See `references/examples.md` for synthetic calls modelled on the runnable
fixtures: a full resolution, a desk that cannot state a status but names the
documents, a reference heard wrong and caught by the read-back, and a call
that never completed.

## Side effects and cancellation

One call per authorized claim version. The workflow creates no recurring
schedule and no second leg. A call in flight cannot be cancelled through the
CALL-E Developer API, so the cancellation story is that a call is only
started once the authorization gate has passed; there is nothing to withdraw
afterwards. Any retry reuses the original idempotency key and therefore
returns the original call rather than dialling again.

## The governed implementation

A runnable implementation with a no-call default lives in
`apps/python/warrantyops/`. Every surface of it routes through one gate
chain — no Skill, CLI or MCP tool can bypass the kernel.

- **CLI** (`python -m warrantyops`): deterministic scenarios through the
  fake provider, receipts, and the offline `make judge` path.
- **Review surface**: nothing learned on a call is written back without a
  human decision bound to the review packet's id *and* body hash. A refusal
  or a return-to-digital is recorded as a safe non-write.
- **Receipts and evidence classes**: every public claim carries exactly one
  class — `Recorded CALL-E result`, `Synthetic scenario`, or `Fictional case data`.
  The executed-vs-limitations split is pinned in
  `apps/python/warrantyops/docs/evidence-table.md`.
- **Claim adapter contract**: how a system of record supplies a claim and
  receives the five output artifacts —
  `apps/python/warrantyops/docs/adapter-contract.md`.
  A DMS/ERP integration is planned, not built.
- **MCP surface** (`warrantyops/mcp_surface.py`): three tools only —
  `assess_claim`, `request_authorized_inquiry`, `review_and_write_back`.
  Read-only and fake by default; the surface constructs no live provider.

To reproduce the gates from a fresh clone, see
`apps/python/warrantyops/proof/independent-run.md` — which also states
plainly that no third party has run it yet.
