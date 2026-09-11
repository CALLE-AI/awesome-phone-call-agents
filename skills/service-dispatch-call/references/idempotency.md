# Idempotency

One authorized dispatch produces at most one call. This is enforced by the idempotency key, and it only works if the key is derived from the right thing.

## Derive The Key From The Authorization, Not The Attempt

The key must be **the identifier of the thing that was authorized** — the dispatch record, the job, the task row. Not the attempt.

```text
idempotencyKey = dispatchId          # stable across every retry
```

Anti-patterns, each of which silently disables the protection:

```text
idempotencyKey = uuid()              # new on every retry
idempotencyKey = hash(now())         # new on every retry
idempotencyKey = hash(payload + now) # new on every retry
idempotencyKey = uuid() per attempt  # new on every retry
```

If a retry can produce a different key, there is no idempotency. The provider is behaving correctly when it dials again, because you asked it a second question.

## Reserve Before Dialling

Write the dispatch record, with its key, **before** the call is placed.

If the record is written after the provider responds, then a call that is accepted but never reported leaves no trace, and the next attempt has nothing to collide with.

Order:

1. Insert the dispatch as `queued`, with its identifier.
2. Use that identifier as the idempotency key.
3. Place the call.
4. Update the record from the terminal event.

Steps 1 and 2 are the whole mechanism. A record that only exists after success is not a record.

## Replay Safety On The Way Back

Providers redeliver webhooks. Assume every terminal event may arrive more than once.

- Deduplicate on the provider's **event** identifier, not the call identifier. One call produces several events.
- Watch the envelope shape: an event id at the root and a call id nested under `data` are easy to confuse, and binding to the wrong one will attach every callback to a call that does not exist. Read the provider's published schema rather than an example in prose.
- An exact replay of an already-processed event should be accepted and ignored.
- A *conflicting* payload under an already-processed identifier is a real problem. Reject it and raise it, rather than overwriting.

## Retention Of The Guard

The idempotency record must outlive the dispatch it guards.

If the guard is deleted with the dispatch — or worse, if a foreign key without a delete rule makes the dispatch undeletable — then a redelivered event after cleanup can place a second call. Where a relational constraint links them, give it an explicit delete behaviour that keeps the guard and clears the reference.
