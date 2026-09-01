---
name: warranty-recovery
description: Resolve a warranty or entitlement exception with one authorized outbound phone call, returning a coverage decision, a resolution, and an authorization reference that is only asserted after the representative confirmed a read-back. Use when a portal, email or form has refused, stalled, or has no record, and the next step is a phone call to a distributor, manufacturer or service provider.
---

# Warranty recovery call

A warranty exception is what is left when the portal says no, or has no record.
Somebody has to phone, ask whether the failure is covered, and come back with
something an operator can act on. This skill packages that call so that what
comes back is checkable.

The workflow's hard rule is that the result is allowed to be empty. An unknown
that is labelled unknown is worth more than a confident answer nobody said.

## When to use this

Use it when all of the following hold:

- a self-service channel has already refused, stalled, or has no record;
- the counterparty is a business you have an authorization basis to call;
- the outcome the caller needs is a decision plus, sometimes, a reference number.

Do not use it to negotiate warranty terms, to dispute a decision, or to call a
consumer. It asks questions and records answers.

## Before the call

1. Establish the authorization basis. Read `references/safety.md` for the four
   bases this workflow accepts and what each requires. No basis, no call.
2. Write down the case: what the asset is, how it failed, and what the portal or
   email already said. The last one matters most; it is the reason for calling.
3. Derive the idempotency key from the authorization record and the case, never
   from the attempt. A retry must reuse the key; a deliberate re-check must not.

## The call

Ask for two things and accept that either may be unavailable:

- whether the failure is covered, and the words that establish it;
- what they will do next, and the words that establish that.

If a reference number is given, read it back digit by digit and ask them to
confirm before ending the call. See `references/identifier-confirmation.md` for
why this is the one part of the workflow that is not optional.

## After the call

Map what was said onto the contract in `references/result-contract.md`. Three
rules decide most cases:

- A hedge is not a yes. "It should probably be covered" is `UNKNOWN`.
- A call that did not complete has no business outcome. No answer is not
  "not covered".
- A reference the representative never confirmed does not become an
  authorization. The resolution is downgraded instead of the reference being
  asserted.

Read `references/calle-platform-notes.md` before relying on any provider field:
it records what the CALL-E documentation guarantees and, more usefully, what it
explicitly does not.

## Worked cases

See `references/examples.md` for four synthetic calls: a clean success, a
documentation request, a hedged answer, and a reference that was heard wrong
and caught by the read-back.

## Side effects and cancellation

One call per authorized case. The workflow creates no recurring schedule and no
second leg. A call in flight cannot be cancelled through the CALL-E Developer
API, so the cancellation story is that a call is only started once the
authorization gate has passed; there is nothing to withdraw afterwards. Any
retry reuses the original idempotency key and therefore returns the original
call rather than dialling again.

A runnable implementation with a no-call default lives in
`apps/python/warrantyops/`.
