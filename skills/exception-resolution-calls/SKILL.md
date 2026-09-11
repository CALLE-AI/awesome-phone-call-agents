---
name: exception-resolution-calls
description: Use when a business workflow is blocked waiting on a person to answer a question by phone — a stale purchase order, an unconfirmed delivery window, a job a technician has not accepted — and the answer must update system state. Turns one CALL-E call task into per-recipient structured evidence, then advances the workflow with deterministic policy instead of letting a model decide.
---

# Resolving blocked workflows by phone

## When to use this

Use it when three things are true at once:

1. a workflow is **stuck on a fact only a person has** ("did you get the order?",
   "will it ship Friday?", "can you take this job?");
2. the answer has to **change system state**, not just get logged;
3. a wrong answer has a **real cost**, so "we think they said yes" is not good
   enough.

Do not use it for open-ended conversations, for anything where the caller must
negotiate or commit the business to something, or where no bounded set of
questions exists. Those are not exception resolution; they are sales, and they
need a human.

## The shape of the problem

The tempting design is: call, ask the model what happened, update the record.
That design fails in production for a reason worth stating plainly.

**Extraction and authority are different jobs.** A model is good at turning a
messy conversation into structured fields. It is not the right thing to decide
whether a purchase order may be closed, because when the evidence is thin it
will still return *something*, and that something becomes a business fact
nobody chose.

So split them:

```
CALL-E                          Your policy code
──────                          ────────────────
holds the conversation          decides what the answer means
extracts strict JSON            re-validates the JSON
reports confidence              can refuse to act on low confidence
never touches state             owns every state transition
```

## Build it in this order

### 1. Model uncertainty before you model success

Write the result schema first, and give every judgment field an `unknown`
value. This is the single highest-leverage decision in the whole design.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["received", "po_status", "needs_human"],
  "properties": {
    "received": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes ONLY when they clearly confirm receipt. Use unknown when the answer was hedged, second-hand or unclear — for example 'I think someone in logistics has it'."
    },
    "po_status": {
      "type": "string",
      "enum": ["on_time", "delayed", "blocked", "unknown"],
      "description": "Never infer a status from tone or from a polite acknowledgement."
    },
    "needs_human": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes when they ask for a person, dispute the record, or raise pricing, payment terms or contract changes."
    }
  }
}
```

Three rules that are easy to get wrong:

- **Enums, not booleans**, for anything a call might not settle. A boolean
  forces a guess; an enum lets the call say "I don't know", which is usually
  the true answer.
- **`additionalProperties: false`**, and no `$ref`, `oneOf`, `anyOf`, `allOf`
  or recursion — CALL-E does not support them. A generated schema from a typed
  model will emit `$ref` and silently return `null` results forever.
- **Do not name a recipient field `status`, `summary`, `transcript` or
  `call_id`.** Those are reserved on recipient results. The collision does not
  error; it just returns `null`. Rename yours (`po_status`, `customer_summary`).

### 2. Bound the call before you place it

The task text is a contract with the person who answers. State what may be
disclosed, what may be asked, and what ends the call.

```
YOU MAY DISCLOSE ONLY
- the supplier company name;
- the purchase order number.

TRUTHFULNESS
- Never guess a date, quantity, status or commitment.
- If unclear, ask one clarification question, then report unknown.
- Do not convert a polite acknowledgement into a business commitment.

SCOPE
- Do not negotiate price, discounts, payment terms or contract terms.
- Do not collect passwords, card data or bank credentials.
- If the recipient asks for a human, stop and report needs_human = yes.
```

**Scan the operator-supplied values, not the rendered task.** This bites
everyone once: the task above contains the words "password", "credentials",
"negotiate" and "price", so a scanner pointed at the rendered text flags the
task's own safety rules and blocks every call you try to make. Scan the
untrusted surface — the interpolated names, ids and numbers — and leave the
template alone.

### 3. Batch recipients, keep outcomes separate

`recipients[]` plus `recipient_result_schema` means one call task can cover
many people, each with an independent result. It is cheaper and it demos far
better than a loop of single calls.

```python
call = client.calls.create(
    task=task_text,                                  # says "ask each about THEIR order only"
    recipients=[{"phones": [p], "region": "US"} for p in phones],
    recipient_result_schema=RECIPIENT_SCHEMA,        # per person
    result_schema=ROLLUP_SCHEMA,                     # whole batch
    metadata={"workflow_run_id": run_id},
    idempotency_key=batch_key,                       # header
)
```

Two things to get right:

- The task must **explicitly forbid cross-disclosure** ("never mention another
  supplier's order to anyone"), or a batch call leaks one customer's business
  to another.
- Correlate results back by `recipients[i].id`. If you cannot match a result to
  a workflow, record it as unattributed and decide nothing — guessing which
  record a phone answer belongs to is worse than leaving it.

### 4. Derive the idempotency key from content, never from a clock

A create that times out may already have started a phone call. Retrying with a
fresh key calls a real person twice.

```python
key = "wf:batch:" + sha256("|".join(sorted(f"{run}:{attempt}" for ...))).hexdigest()[:32]
```

Same logical batch → byte-identical key → CALL-E returns the original call.
Persist the key **before** you dispatch, so a crash mid-flight is recoverable.

### 5. Let policy decide, in a pure function

```python
def decide(workflow, call, recipient, settings) -> Decision:
    if workflow.is_terminal:            return NOOP          # late results never overwrite
    if call.status in ("failed", "canceled"):
                                        return retry_or_escalate(workflow)
    if recipient.status != "completed": return RETRY          # no conversation, no evidence
    if recipient.structured_result is None:
                                        return RECONCILE      # null is never success
    ev = revalidate(recipient.structured_result)              # check enums again yourself

    if ev.escalation_reason == "asked_not_to_be_called":
                                        suppress(recipient); return HUMAN_REVIEW
    if ev.escalation_reason in ("disputes_po", "commercial_change", "wants_human"):
                                        return HUMAN_REVIEW   # distinct reasons, not one flag
    if ev.needs_human == "yes":         return HUMAN_REVIEW   # outranks any positive answer

    could_close = ev.received == "yes" and ev.po_status in ("on_time", "delayed")
    if could_close and ev.spoke_with not in ("intended_contact", "authorized_representative"):
                                        return HUMAN_REVIEW   # right number, wrong/unknown person
    if could_close and not confident_enough(call, settings):
                                        return HUMAN_REVIEW   # dampener, see below

    if ev.received == "yes" and ev.po_status == "on_time":
                                        return RESOLVE
    return HUMAN_REVIEW                                       # ambiguity is never resolved
```

**Record who you actually reached, and why a human is needed, as fields --
not as one flag and a hope.** Two gaps bite in roughly this order:

- An authorized **destination number** is not the same thing as an
  authorized **person**. A clean "yes, on time" from whoever happens to
  pick up is not evidence, if that person was never the contact. Add a
  `spoke_with` field (self-reported, not authenticated) and gate any
  outcome that would close the workflow on it. See `references/decision-table.md` for the full precedence.
- A single `needs_human` boolean cannot tell an operator whether the
  recipient asked for a person, disputed the record, tried to
  renegotiate, or asked never to be called again. The last one has a
  consequence beyond this call: it must suppress future attempts to this
  contact, not just get logged. Differentiate the reason
  (`escalation_reason`), and act on the ones that need acting on.

**Use confidence as a dampener, in one direction only.** `task_completed` and
`completion_confidence` are reported for the whole call task, not per recipient.
Low confidence may *withhold* an automatic resolution; high confidence must
never *rescue* a recipient whose own result is missing or ambiguous. Getting
this backwards is how a confident-sounding batch closes an order nobody
confirmed.

**Never branch on `failure_code`.** The API documents it as having no published
enum. Store it, show it to a human, and drive retry from `status` instead.

### 6. Say who you are before you ask anything

The recipient did not opt into this call. Before discussing the order:

- state plainly that you are an AI assistant, not a person;
- name the real company you are calling for -- never a placeholder, and
  never the name of your own agent/product;
- confirm you are speaking to the right person *before* disclosing order
  details, not after.

Refuse to dispatch a live call if you cannot fill in a truthful company
name. A placeholder would be spoken aloud to a real person.

### 7. Treat the webhook as a notification, not an answer

```
POST /webhooks/...
  → validate shape
  → dedupe on the event id (a UNIQUE column, not a SELECT)
  → enqueue reconciliation
  → return 200
```

Then fetch the call and decide **there**. Three properties fall out for free:
a duplicate delivery is a no-op; a lost delivery is only a delay, because a
sweep reconciles anything that has been running too long; and you can develop
with no public URL at all.

## Failure modes worth designing for

| Failure | Correct behaviour |
|---|---|
| Create times out | Retry with the **same** key |
| Webhook delivered twice | Second is a no-op |
| Webhook never arrives | Reconciliation sweep finishes the call |
| `structured_result: null` | Reconcile, then retry, then escalate — never resolve |
| Recipient never answered | No evidence exists, whatever the result object says |
| Right number, wrong person answers | Escalate even on a clean "yes" -- identity was never established |
| Someone resolved it by hand mid-call | Keep the result as history; do not overwrite |
| Attempts exhausted | Escalate to a person, do not keep dialling |
| Caller asks to renegotiate | Escalate; the agent has no authority |
| Caller asks not to be called again | Escalate **and** suppress this workflow record; decide deliberately whether that should also cover other open records for the same number, or it silently won't |

## Cancellation and side effects

A call is a side effect you cannot take back — someone's phone rings. So:

- Nothing dials without passing an eligibility check **and** an attempt budget.
- Gate live calling behind an explicit flag *plus* a key, so no single stray
  environment variable starts calling people.
- Keep an allowlist of numbers during development; a batch containing an
  unlisted number should fall back to a simulator rather than dial.
- Bound attempts (3 is a reasonable default) with a backoff between them, and
  escalate when the budget is gone.
- Distinguish "not due yet" and "quiet hours" from real refusals. Those fix
  themselves, so they must not be escalated — a false alarm on someone's queue
  is how they learn to ignore the queue.

## Where to look next

- Read `references/safety.md` for the boundaries this pattern assumes:
  phone-number handling, consent, credentials, cancellation, and the
  conversations that must escalate rather than continue.
- Read `references/examples.md` for runnable request and response
  shapes, including batch calls and the terminal webhook.
- Consult `references/decision-table.md` for the full branch precedence
  and the retry-versus-escalate rule.
- Use `references/result-schema.json` as a starting point for your own
  strict result schema.
- Run `scripts/idempotency_key.py` to see the content-derived key, and
  to confirm it is stable under reordering.

## Reference implementation

Resolve-E implements all of the above for supplier purchase-order
acknowledgements: one CALL-E call task resolves eight purchase orders
into their distinct outcomes -- including the identity-gate and
escalation-differentiation cases this file just described -- each with
its own policy decision and audit trail, and the failure table above is
a test suite rather than a promise.
