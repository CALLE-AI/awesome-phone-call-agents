# Warranty recovery: background and design notes

Long-form guidance for the [`warranty-recovery`](../../skills/warranty-recovery/)
skill and the [`apps/python/warrantyops`](../../apps/python/warrantyops/)
reference application. The skill itself stays short on purpose; this is the
material a reader wants once they have decided to adapt it.

## Why a phone call

Warranty and entitlement exceptions are the claims that self-service could not
settle. A portal has no record of the serial, a form rejects the purchase date,
an email thread has gone four days without a reply. The information needed to
settle the claim exists, and it is in the head of a person on a support line.

That makes the phone call the cheapest remaining step, and also the one nobody
wants to do, because it is thirty minutes of hold music for a five-word answer.

## Why the result is allowed to be empty

The failure mode of an automated call is not silence. It is a confident
paragraph that reads like an outcome and is not one. A summary that says *"the
distributor indicated the unit is likely covered and will follow up"* is worse
than no call at all, because an operator will act on it.

So the contract is built the other way round. Every field has an explicit
"not established" value, coverage decisions require the words that establish
them, and the transport layer is not allowed to contribute to the business
answer. The states are enumerated in
[`references/result-contract.md`](../../skills/warranty-recovery/references/result-contract.md).

## Why the read-back is separate from the extraction

Most fields in this contract degrade gracefully. A missing return deadline
costs a follow-up. A missing coverage decision costs a call back.

One field does not degrade gracefully. An authorization reference that is wrong
by one digit is indistinguishable from a correct one until a shipment arrives
against it, and every automated check in the pipeline passes: the value is a
string, it matches the pattern, the model was confident, the schema validated.

The only signal that separates a correct reference from a wrong one is whether
the person who issued it heard it read back and agreed. That is a property of
the conversation, not of the extraction, which is why the instruction lives in
the task text and the gate lives in
[`identifiers.py`](../../apps/python/warrantyops/warrantyops/identifiers.py).

The design consequence worth copying: **when a field's failure mode is
qualitatively different, give it its own state machine rather than another
column in the same schema.**

## Why transport state and business state are separate objects

The CALL-E documentation is unusually explicit here: `failure_code` on the
Calls API has no published enum, the API does not currently guarantee a
distinct no-answer or callee-decline value, and integrators are told to keep
the business outcome unresolved rather than infer one from a generic failure.

A workflow that folds those together produces "not covered" for a call nobody
answered, which is the same class of error as an invented RMA and harder to
notice, because the value is plausible.

## Portability

Only the contract module knows what a warranty is. The authorization gate, the
idempotency derivation, the identifier state machine, the validation subset and
the transport separation are all domain-independent, and the identifier control
is the part most worth lifting: any workflow that comes back with a case
number, a booking reference, a policy number or a prescription number has the
same problem.

## Related repository material

- [`docs/production-workflows.md`](../production-workflows.md) for the wider
  operational patterns.
- [`docs/design-principles.md`](../design-principles.md) for the repository's
  own framing of portability, provider separation and safety by default.
