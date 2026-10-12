# Failure mapping

Per server §17. The worker maps CALL-E responses and transport failures to a controlled
mission status + brief outcome.

## Outcomes

| Outcome | When |
|---|---|
| `resolved` | Call completed and the JSON schema was filled cleanly with a fact-bearing response. The user's goal was achieved. |
| `needs_human` | The callee asked for a commitment, OTP, or human voice. The brief is the "you take over" handoff. Also the safe default when the transcript is ambiguous. |
| `voicemail` | Voicemail detected. Brief explains the message left. |
| `unavailable` | No answer, busy, network unreachable. |
| `refused` | Callee declined to engage ("we don't do that"). |
| `failed` | Transport error / API 4xx. Brief carries the error message. |

## Status transitions

```
draft → previewed → queued → planning → dialing → in_conversation → wrapping
                                                                      ↘ completed
                                                                       ↘ voicemail
                                                                        ↘ failed
                                       ↘ canceled (user-initiated, anytime)
```

`previewed` is mandatory before a live dial. The server enforces this — `start` will auto-generate
the task string if `previewed` was skipped, but only after the same safety gates.

## Evidence chain

Every fact in `brief.facts` should be traceable to a span in the transcript. The server stores
a 240-char excerpt of the transcript as `evidence[0].quote`. If the call is too short to
demonstrate a fact, leave the fact empty — do not invent.

Example:

```json
"facts": {
  "tracking_number": "AWB 8821",
  "status": "Out for delivery",
  "expected_time": "4 PM today"
},
"evidence": [
  {
    "quote": "Surrogate: Hi, this is AfterHold calling on behalf of the user. Could you confirm AWB 8821?\nDispatcher: Yes, out for delivery, expected by 4 PM.\n…"
  }
]
```

## Worker crash recovery

If the worker process crashes while a mission is live, the next 5-second sweeper picks the
mission up via `tickAllLive()` and restarts `runMission()` from its current `calle_call_id`.
The mission is never lost.

## CALLE_ENABLED kill switch

Setting `CALLE_ENABLED=0` is a hard freeze:

- New `/start` calls return 503.
- Live missions continue to terminal — they were already accepted.
- The kill switch is **never** enforced in `CALLE_MOCK=1` (mock has no real cost).
