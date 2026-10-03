# Examples

## Placing the call (Python)

Adapted from a production feedback-pipeline integration. `RESULT_SCHEMA` asks CALL-E for a structured result instead of a raw transcript, and the idempotency key is derived from the order id so a duplicate dispatch trigger cannot create a second call for the same order.

```python
from calle import CalleClient

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "satisfaction_score": {"type": "integer", "description": "1 to 5"},
        "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
        "missing_items": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Items the customer said were missing from the order.",
        },
        "customer_summary": {
            "type": "string",
            "description": "Short summary of what the customer said.",
        },
    },
    "required": ["sentiment", "customer_summary"],
    "additionalProperties": False,
}


def place_feedback_call(client: CalleClient, *, phone: str, business_name: str,
                         order_id: int, webhook_url: str) -> dict:
    task = (
        f"On behalf of {business_name}, call the customer to collect feedback "
        "about their completed order. Use a short fixed opening, then let the "
        "customer speak freely about satisfaction, issues or suggestions."
    )
    return client.calls.create(
        task=task,
        recipient={"phone": phone, "locale": "en-US"},
        result_schema=RESULT_SCHEMA,
        metadata={"order_id": str(order_id), "source": "customer-feedback-callback"},
        webhook_url=webhook_url,
        # Derived from the order id, not a timestamp or random value, so a
        # redelivered/duplicate dispatch trigger cannot double-call the customer.
        idempotency_key=f"order-{order_id}",
    )
```

### Dry-run / no-call path

Before wiring this to a real `CalleClient`, exercise the same function with a fake client that returns a canned `completed` result and a canned `no_answer` result, and confirm the webhook handler below produces the right outcome for each without placing a real call:

```python
class FakeCalleClient:
    def __init__(self, canned_result: dict):
        self._result = canned_result

    class _Calls:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kwargs):
            return {"id": "fake-call-1", "status": "queued", **kwargs}

    @property
    def calls(self):
        return self._Calls(self)
```

## Handling the webhook result

Normalize the payload into a terminal outcome before doing anything else with it — this is what keeps `no_answer` from ever being treated as a real conversation, and what keeps an ambiguous `failed` from ever being treated as an equivalent-to-`no_answer` retry trigger.

```python
_NO_ANSWER = {"no_answer", "no-answer", "unanswered", "missed"}
_VOICEMAIL = {"voicemail", "voicemail_received", "answering_machine", "left_message"}


def classify_outcome(payload: dict) -> str:
    status = (payload.get("status") or "").lower()
    if status in ("canceled", "failed"):
        return status
    recipients = payload.get("recipients") or []
    recipient_status = (recipients[0].get("status") if recipients else "failed") or "failed"
    recipient_status = recipient_status.lower()
    if recipient_status in _NO_ANSWER:
        return "no_answer"
    if recipient_status in _VOICEMAIL:
        return "voicemail"
    if status == "completed":
        return "completed"
    return status or "in_progress"


def handle_webhook(payload: dict) -> None:
    outcome = classify_outcome(payload)
    if outcome == "completed":
        result = payload.get("structured_result") or {}
        run_triage(result)  # feedback -> investigation + trend -> supervisor
    elif outcome == "no_answer":
        # The ONE verified, terminal non-contact outcome that gets a
        # single automatic redial.
        schedule_one_retry(payload, delay_minutes=5)
    elif outcome in ("voicemail", "canceled"):
        pass  # certain terminal outcomes, but not "unreachable" — no retry
    else:
        # "failed" (can mean a transient provider/network error, not a
        # confirmed customer non-contact) and anything classify_outcome
        # didn't recognize: NEVER auto-retried — that would silently keep
        # re-dialing on an ambiguous signal. Hold for a human or a
        # separate reconciliation job instead.
        hold_for_reconciliation(payload, outcome)
```

## Sample structured result -> recommendation

```json
{
  "sentiment": "negative",
  "satisfaction_score": 3,
  "missing_items": ["ayran"],
  "customer_summary": "Customer said the order arrived without the ayran they ordered."
}
```

```text
Feedback agent   -> sentiment: neutral-to-negative, priority: high (missing item reported)
Investigation    -> 2 prior late-delivery complaints in the last 30 days for this customer
Trend            -> "missing ayran" tag: 10 occurrences in the last 7 days (0 the week before)
Supervisor       -> RECOMMENDATION (not auto-applied): urgent — missing item: ayran
                    -> human-facing notification only; no refund/credit issued by this workflow
```
