# Ringback â€” Phone Work, Handled for You

An agent that makes the phone call a caregiver doesn't have time to make:
turning a stressed, unstructured description ("my mom's pharmacy won't refill
her prescription without prior authorization and I can't sit on hold") into a
precise phone task, placing the real call, and returning a clear, verified,
structured outcome the caregiver can act on.

This is **not** a generic "AI that makes phone calls" demo. It flips the
frame: a call *on behalf of* someone, standing in for a call they cannot make
themselves, in a moment that matters to them personally.

## The real-world problem

Unpaid caregivers â€” adult children of aging parents, parents of disabled
children, spouses managing a partner's care â€” routinely lose significant time
and emotional energy to administrative phone calls: pharmacy prior
authorizations, insurance claim disputes, appointment scheduling, billing
errors. Ringback takes one such situation and resolves the phone-work end to
end, with a fail-closed guarantee: a result is only ever shown as
**Confirmed** when the evidence supports it.

## How it works

```
Caregiver's natural language
        v
Understand request (deterministic intent/target planner)
        v
Resolve recipient (contact directory + optional user number + demo override)
        v
Generate internal CALL-E task + result schema (never shown to the caregiver)
        v
One real CALL-E call (async create, poll to terminal state)
        v
Verify: completed + task_completed + schema-valid + confidence high enough
        v
WE FOUND OUT  |  NEEDS ATTENTION  |  CALL COULD NOT BE COMPLETED
```

## How CALL-E is used

- **Task generation** â€” the caregiver's raw situation plus the planner's goal
  (intent, target type, required questions, resolved calendar dates) is
  composed into a precise natural-language `task`. Tasks are phrased as
  open-ended inquiry ("ask the office whichâ€¦") so CALL-E's goal-clarification
  has nothing left to ask.
- **Structured extraction** â€” a `recipient_result_schema`
  (`outcome` / `result_summary` / `next_step` / `confidence_indicator`)
  tells CALL-E what facts to extract. Recipient-level (not task-level) is
  the placement proven to complete live calls; the task itself carries no
  phone prefix, only the goal and an explicit self-introduction.
- **Async lifecycle** â€” `POST /v1/calls` returns a `call_id` immediately;
  the server polls `GET /v1/calls/{call_id}` through
  `queued â†’ in_progress â†’ completed|failed|canceled`, so the browser never
  freezes. `Idempotency-Key` makes creation retries safe.
- **Fail-closed confidence check** â€” `task_completed`, `completion_confidence`
  (score/label), null-result handling, and unclear-outcome handling decide
  between Confirmed and Needs Attention. An uncertain result is never
  presented as certain.

## Setup

1. Get a CALL-E API key from `https://dashboard.heycall-e.com/account/api-keys`.
2. Copy it into `.env` (see below). Never commit `.env` â€” it is git-ignored.
3. Start the server and open `http://localhost:8080`.

```powershell
# .env
CALLE_API_KEY=your_key_here
CALLE_BASE_URL=https://api.heycall-e.com
SANDBOX_TARGET_PHONE=+91XXXXXXXXXX   # demo override: your own test phone
DEMO_MODE=1                          # 1 = route demo contacts to sandbox number

# start
powershell -NoProfile -ExecutionPolicy Bypass -File ".\start_server_logged.ps1"
```

Type a situation (e.g. *"My wife's pharmacy says her blood pressure
medicine needs approval from her doctor."*), confirm the identified contact,
click **Call & Find Out**, and watch the live status through to the verified
result. Phone numbers stay masked in the UI; the API key never leaves the
server.

No-call preflight is built in: `/api/plan` and `/api/resolve` validate
intent, recipient, and E.164 format before credentials are ever used, and
`POST /api/preview` shows the exact payload that would be sent — all
without placing a call.

## Tests (no calls placed)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\test_ringback.ps1"
```

Covers intent planning (pharmacy/appointment/insurance), empty-input and
missing-number validation, single + multi-contact resolution (masked),
named-contact lookup, in-text number detection (+91 normalize), history
report, proven call shape (no phone prefix + recipient schema), reserved
schema-field guard, fail-closed evaluation, region defaults, learned
address book, and transcript follow-up mining — currently 61/61 passing.

Multi-contact: `POST /api/resolve` returns every relevant contact
(e.g. pharmacy text â†’ doctor + pharmacy cards), each callable separately.
Recipient region is `US/en-US` (proven route to the sandbox number; `IN`
restore is pending a local-line enablement â€” see server comment).

## Side effects & cancellation

Each Call click places exactly one real outbound phone call (explicit
consent per call, idempotency-keyed). There are no recurring or scheduled
calls, so there is nothing to cancel — a dialed call cannot be recalled;
its verdict lands in the Situation Report either way.

## Platform

Windows + Windows PowerShell 5.1 host (uses `HttpListener`). The UI is a
browser page (mobile-responsive, works from a phone browser on the same
network). The React/TypeScript source builds with Node 24 + `npm run build`.

## Demo staging honesty

For reliable recording, demo calls ring the builder's own sandbox number
with the builder role-playing the office. The call is a genuine CALL-E call
(live dial, transcription, structured extraction); only the far end is staged.

## License

MIT â€” see [LICENSE](LICENSE).


