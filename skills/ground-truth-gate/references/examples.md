# Worked Examples

All numbers below are fictional samples. Run the decisions yourself:

```bash
python3 scripts/gate.py --demo
python3 scripts/gate.py --input assets/sample-claim.json --claim-id claim-42
python3 scripts/self_test.py
```

## 1. Gate: the evidence is broader than the question

A user asks whether the Bellevue branch has a Bosch HBL8453UC wall oven in stock for pickup today. The catalogue holds one page, crawled 427 days ago: "In stock at Northgate Appliance."

That text is about the chain. The question is about one branch, today. It is also more than a year old, and a wrong yes sends the user across town for nothing.

```text
asked:    hbl8453uc/in-stock/this-branch    evidence: hbl8453uc/in-stock (427 days old)
decision: gate - evidence does not answer the question asked and a wrong answer is expensive
party:    Northgate Appliance, Bellevue branch +14*******00
```

The four-part response, as `format_contract()` builds it:

1. `provisional`: probably in stock, but the listing is chain-wide, not branch-level; evidence 427 days old.
2. `gap`: "Is the Bosch HBL8453UC wall oven in stock at this branch today?"
3. `call`: one disclosed call task to the branch, `result_schema` attached, `unknown` available.
4. `record`: `claim-42`, provisional, awaiting correction, surfaced as unresolved after 6h.

The call opens with disclosure before it asks anything: an automated assistant, calling on behalf of a customer, this call may be recorded. There is no path through this skill that produces an undisclosed call.

## 2. Disclose: the same gap, but being wrong is cheap

A user asks whether a coffee shop still has oat milk. Same shape of gap, trivial cost of error.

```text
decision: disclose - wrong answer is cheap, so state the answer with its evidence age
```

No call. Nobody's afternoon gets interrupted so an agent can sound certain about oat milk.

## 3. Blocked: the cost of being wrong is unknown

A user asks whether a supplier still honours a quoted lead time. The agent does not know what a wrong answer costs them — it might be a rescheduled afternoon or a missed production window.

```text
decision: blocked - cost of being wrong is unknown, so ask the user before deciding to call
```

This is deliberately not `disclose`. Guessing "cheap" is how a call silently never happens, with no blocker raised and no signal to the user that the agent invented a judgement it did not have.

## 4. Blocked: nobody asked

The agent notices mid-task that a cached price is stale and considers calling to refresh it.

```text
decision: blocked - the user has not asked for this answer, and curiosity is not intent
```

`Claim.user_requested` is a required field, so this is a code path, not a guideline. A phone call is a real-world side effect on a stranger's day, and no amount of usefulness converts an unasked question into consent.

## 5. Blocked: no authoritative number was supplied

Same stock question, no phone number on file.

```text
decision: blocked - no phone contact supplied for the authoritative party (Northgate Appliance, Bellevue branch)
```

The response states the blocker and asks the user for the number. It does not search for one, and it does not call the first number it can find. A call to the wrong party produces a confident answer from someone with no standing to give it. A malformed number blocks the same way: an invalid E.164 string is a blocker to report, never a string to repair by guessing a country code.

## 6. The correction, after the call lands

The webhook is a notification, not a source. CALL-E deliveries are unsigned, so the handler re-fetches `GET /v1/calls/{id}` and works from that. The event wraps the whole call task under `data`, so the verdict is at `data.structured_result` and the transcript is at `data.recipients[].attempts[].transcript_turns`:

```json
{
  "id": "evt_9f2c41",
  "type": "call.completed",
  "created_at": "2026-09-09T18:22:41Z",
  "data": {
    "id": "call_7a13d8",
    "object": "call_task",
    "status": "completed",
    "metadata": {"claim_id": "claim-42", "gate": "ground-truth-gate"},
    "structured_result": {
      "verdict": "confirmed_false",
      "quoted_answer": "Not at this branch, no. The Bellevue store has one but we are out until Thursday.",
      "valid_until_note": "They expect a delivery Thursday."
    },
    "task_completed": true,
    "completion_confidence": {"score": 0.93, "label": "high"},
    "recipients": [
      {
        "phones": ["+14*******00"],
        "status": "completed",
        "attempts": [
          {
            "phone": "+14*******00",
            "status": "completed",
            "transcript_turns": [
              {"speaker": "agent", "text": "Is the Bosch HBL8453UC wall oven in stock at this branch today?"},
              {"speaker": "recipient", "text": "Not at this branch, no. The Bellevue store has one but we are out until Thursday."}
            ]
          }
        ]
      }
    ]
  }
}
```

Reconcile it:

```bash
python3 scripts/gate.py --reconcile assets/sample-result.json --abstain false
```

Three details a handler gets wrong if it guesses:

- `completion_confidence` is an object with `score` between 0 and 1 and a `label` such as `low`, `medium`, or `high`. It is not a bare string.
- The top-level `id` identifies the event and is the key for processing the side effect exactly once. `data.id` is the call. Confusing them means a redelivered event writes the correction twice.
- `completion_confidence` and `task_completed` are `null` until CALL-E has a terminal post-summary outcome, so a handler that reads them eagerly gets `null`, not a low score.

This one is released, because `confirmed_false` is positive evidence and the abstention gate did not abstain. The user is shown the correction with the quote, the party, and the time. The provisional answer is replaced, not quietly appended to.

## 7. The outcomes that must never become a yes

| Returned | Written back as fact? |
| --- | --- |
| `unknown`, the person was unsure | No. Provisional answer stands. |
| `refused_to_answer` | No, and this is a normal outcome. |
| No answer, voicemail, line busy | No. A call that did not happen is not a call that said yes. |
| `confirmed_true`, but the abstention gate abstained | No. The calibrated set outranks a confident sounding transcript. |
| `confirmed_true`, but no abstention decision was supplied | No. A missing signal is absence of evidence, and `release()` withholds on anything that is not an explicit `False`. |
| `call.failed` | No. The claim is unresolved, not answered. |
| `call.result_validation_failed` | No. The call happened but the extraction did not satisfy the schema, so there is no verdict to trust. |
| No terminal event ever arrives | No — see below. |

The failure this table prevents is the tempting one: several near misses, and a summary that reports "verified".

## 8. The sweep: silence is the dangerous outcome

The last row is the one that bites, because nothing happens and nothing looks wrong. The user acted on a provisional answer believing a correction was coming, and none ever arrives.

```python
if sweep_due(placed_at, time.time()):
    # Six hours, no terminal event. Say so.
    notify(user, f"Still unconfirmed: {claim.question} The call did not come back.")
```

`sweep_due()` is the check, `DEFAULT_SWEEP_HOURS` is the deadline, and the host scheduler runs it — this skill has no internal timer, per repository Principle 2. An unresolved claim that nobody sweeps is indistinguishable from a confirmed one, which is exactly the confusion the gate exists to prevent.
