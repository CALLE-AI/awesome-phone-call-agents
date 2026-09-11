# Examples

Every phone number below is from a documentation range. Every supplier
is invented.

## Resolving one blocked purchase order

```python
import hashlib
import os

import httpx

BASE = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
KEY = os.environ["CALLE_API_KEY"]

RECIPIENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "received", "po_status", "ship_date", "needs_human",
        "spoke_with", "escalation_reason",
    ],
    "properties": {
        "received": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes ONLY when the supplier clearly confirms receipt. Use unknown "
                "when the answer was hedged or second-hand, for example 'I think "
                "someone in logistics has it'."
            ),
        },
        "po_status": {
            "type": "string",
            "enum": ["on_time", "delayed", "blocked", "unknown"],
            "description": "Never infer a status from tone or a polite acknowledgement.",
        },
        "ship_date": {
            "type": "string",
            "description": (
                "The date exactly as stated, for example '2026-09-15' or 'next "
                "Tuesday'. Use the literal string 'unknown' if none was given."
            ),
        },
        "needs_human": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Use yes for a routine, undifferentiated request for a person.",
        },
        # An authorized destination number is not an authorized person.
        # Self-reported, not authenticated -- see references/safety.md.
        "spoke_with": {
            "type": "string",
            "enum": [
                "intended_contact", "authorized_representative",
                "wrong_person", "unknown",
            ],
            "description": (
                "Who you actually spoke to. unknown if identity was never "
                "established -- do not assume it from the fact someone answered."
            ),
        },
        # Distinguishes WHY a human is needed, so "don't call me again" can
        # actually be acted on instead of collapsing into needs_human=yes.
        "escalation_reason": {
            "type": "string",
            "enum": [
                "none", "wants_human", "disputes_po",
                "commercial_change", "asked_not_to_be_called", "unknown",
            ],
            "description": (
                "asked_not_to_be_called suppresses future calls for this record -- "
                "only use it when they actually say so. A number-wide do-not-call "
                "list is a separate, deliberate decision -- do not assume one "
                "record's suppression covers others for the same contact."
            ),
        },
    },
}


def idempotency_key(workflow_run_id: str, attempt_no: int) -> str:
    """Derived from the work, never from a clock or a random value."""
    digest = hashlib.sha256(f"{workflow_run_id}:{attempt_no}".encode()).hexdigest()
    return f"po-ack:{digest[:32]}"


response = httpx.post(
    f"{BASE}/v1/calls",
    headers={
        "Authorization": f"Bearer {KEY}",
        # Same key on every retry of this attempt. A create that timed
        # out may already have started a call.
        "Idempotency-Key": idempotency_key("wr_4821", 1),
    },
    json={
        "task": TASK_TEXT,  # see "Bounding the call" below
        "recipients": [{"phones": ["+15550001111"], "region": "US", "locale": "en-US"}],
        "recipient_result_schema": RECIPIENT_SCHEMA,
        "metadata": {"workflow_run_id": "wr_4821", "attempt_no": 1},
        "webhook_url": "https://example.com/webhooks/calle",
    },
    timeout=30,
)
call = response.json()
print(call["id"], call["status"])
```

## Resolving several orders in one call task

`recipients[]` plus `recipient_result_schema` gives each supplier an
independent outcome from a single call task. Cheaper than a loop, and
the task text must forbid cross-disclosure or one customer's business
leaks to another.

```python
recipients = [
    {"phones": ["+15550001111"], "region": "US"},
    {"phones": ["+15550002222"], "region": "US"},
    {"phones": ["+15550003333"], "region": "US"},
]

payload = {
    "task": batch_task_text,          # names which PO belongs to which number
    "recipients": recipients,
    "recipient_result_schema": RECIPIENT_SCHEMA,
    "result_schema": {                 # a small batch rollup
        "type": "object",
        "additionalProperties": False,
        "required": ["suppliers_reached"],
        "properties": {"suppliers_reached": {"type": "integer"}},
    },
    "metadata": {"batch_id": "b_2026_09_09_a"},
}
```

Correlate results back by `recipients[i].id`, recorded when the call was
created. If a result cannot be matched to a workflow, record it as
unattributed and decide nothing.

## Bounding the call

```text
You are an AI assistant making a call for Acme Buyer Corp. You are
collecting facts needed to resolve a supplier purchase-order
acknowledgement. You are not a general assistant, and you must not
invent information.

CALL CONTEXT
You are calling several suppliers about different purchase orders. Ask
each recipient about THEIR OWN order only. Never mention another
supplier's order, company name, or status to anyone.

- +15550001111 is Jordan at Acme Components, regarding PO-4821.
- +15550002222 is Sam at Globex Industrial, regarding PO-4822.

HOW TO OPEN THE CALL
Say that you are an AI assistant calling on behalf of Acme Buyer Corp,
that this is about a purchase order acknowledgement, then ask whether
you are speaking with the right contact. Do not discuss order details
until they confirm who they are. If asked whether you are a person,
say plainly that you are an AI assistant.

ASK, IN THIS ORDER
1. Confirm you are speaking with the named contact, or someone authorized
   to speak for the supplier about this order. Do not proceed until this
   is answered.
2. Confirm whether the purchase order was received and acknowledged.
3. Ask the current status: on time, delayed, blocked, or unclear.
4. If delayed or blocked, ask for the expected ship date if known.
5. Ask whether they need a human follow-up.

TRUTHFULNESS
- Never guess a date, quantity, status or commitment.
- If unclear, ask one clarification question, then report unknown.
- Do not convert a polite acknowledgement into a business commitment.

SCOPE
- Do not negotiate price, discounts, payment terms or contract terms.
- Do not collect passwords, card data or bank credentials.
- If the recipient asks for a human, stop and report needs_human = yes.
- If they ask not to be called again, stop immediately, acknowledge it,
  and report escalation_reason = asked_not_to_be_called. Do not argue.

Never say the order is resolved. Collecting evidence is the whole job;
someone else decides.
```

The identity confirmation is not decoration: a purchase order must not
close on a "yes" from whoever happens to answer the number, only from
someone who confirmed they are actually the contact.

## Reading the terminal result

```python
call = httpx.get(
    f"{BASE}/v1/calls/{call_id}",
    headers={"Authorization": f"Bearer {KEY}"},
    timeout=30,
).json()

if call["status"] not in ("completed", "failed", "canceled"):
    return  # still running; decide nothing

for recipient in call["recipients"]:
    if recipient["status"] != "completed":
        continue                     # no conversation, no evidence
    result = recipient["structured_result"]
    if result is None:
        continue                     # null is never success

    # The conversation lives on the nested attempt, not the call task.
    for attempt in recipient["attempts"]:
        for turn in attempt["transcript_turns"]:
            print(turn["offset_seconds"], turn["speaker"], turn["text"])
```

Task-level fields worth using: `task_completed`, `completion_confidence`
(`score` and `label`), and `evidence` — a list of short supporting
quotes. Treat confidence as a dampener that can withhold an automatic
resolution but never grant one.

## Deciding, deterministically

```python
def decide(workflow, call, recipient, settings):
    if workflow.is_terminal:                 return NOOP
    if call["status"] in ("failed", "canceled"):
                                             return retry_or_escalate(workflow)
    if recipient["status"] != "completed":   return RETRY
    if recipient["structured_result"] is None:
                                             return RECONCILE

    ev = revalidate(recipient["structured_result"])   # check enums again

    if ev["escalation_reason"] == "asked_not_to_be_called":
        suppress_future_calls(recipient)
        return HUMAN_REVIEW
    if ev["escalation_reason"] in ("disputes_po", "commercial_change", "wants_human"):
        return HUMAN_REVIEW                  # distinct reasons, not one flag
    if ev["needs_human"] == "yes":           return HUMAN_REVIEW

    could_close = ev["received"] == "yes" and ev["po_status"] in ("on_time", "delayed")
    if could_close and ev["spoke_with"] not in ("intended_contact", "authorized_representative"):
                                             return HUMAN_REVIEW   # right number, wrong person
    if could_close and not confident_enough(call, settings):
                                             return HUMAN_REVIEW   # dampener only

    if ev["received"] == "yes" and ev["po_status"] == "on_time":
                                             return RESOLVE
    return HUMAN_REVIEW                      # ambiguity is never resolved
```

The default is escalation, so a case nobody anticipated lands on a
person rather than silently becoming a "yes". Identity and escalation
reason are checked before the confidence dampener and before any
positive answer, because a confident "yes" from the wrong person, or a
polite refusal to be called again, both outrank a clean-looking result.

## Receiving the terminal webhook

```python
@app.post("/webhooks/calle")
def calle_webhook(body: dict, calle_event_id: str = Header(alias="CALL-E-Event-Id")):
    event_id = body["id"]                      # evt_...
    if already_seen(event_id):                 # a UNIQUE column, not a SELECT
        return {"ok": True, "duplicate": True}

    enqueue_reconciliation(body["data"]["id"])  # decide later, not here
    return {"ok": True}
```

Three event types exist: `call.completed`, `call.failed`, and
`call.result_validation_failed`. The third is a schema-valid-extraction
failure and is easy to miss.

Keep the receiver this small. Fetch the call and decide in a worker, and
three properties follow for free: a duplicate delivery is a no-op, a
lost delivery is only a delay because a sweep reconciles anything
running too long, and you can develop with no public URL at all.

## Reproducing failures without calling anyone

| Scenario | How to produce it |
|---|---|
| Create timed out after the provider received it | Raise from the transport after the double has recorded the call, then retry with the same key |
| Duplicate webhook | Post the same body twice |
| Lost webhook | Post nothing; let the reconciliation sweep find it |
| Null structured result | Return `"structured_result": None` for a completed recipient |
| Recipient never reached | Return `"status": "failed"` on the recipient |
| Attempt budget exhausted | Age the dispatch timestamps and loop |
| Right number, wrong person | Return a clean, closeable result with `"spoke_with": "wrong_person"` |
| Recipient refuses further contact | Return `"escalation_reason": "asked_not_to_be_called"` and assert the contact gets blocklisted |

Read `references/safety.md` for the boundaries these examples assume,
and `references/decision-table.md` for the full branch precedence.
