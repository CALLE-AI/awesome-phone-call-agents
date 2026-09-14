# Safety

A phone call is a side effect you cannot take back. Someone's phone
rings, a real person answers, and whatever the agent says has been said.
Everything below follows from that.

## Phone numbers

Every number dialled must come from a validated, authorised record —
never from free-form user input, and never assembled at call time.

- Validate against the provider's own pattern, `^\+[1-9]\d{6,14}$`,
  **before** dispatch, so a malformed number fails inside your own
  validation layer with an auditable reason rather than as an opaque
  provider 400.
- Keep an allowlist while developing. A batch containing any number not
  on it should fall back to a simulator rather than dial.
- Mask numbers in logs and in any view a person will screenshot. Keep
  the country code and the last two digits: enough to recognise a number
  during an incident, not enough to redistribute it.
- Use documentation ranges in examples. `+15550001111` is safe;
  a number you found in a real system is not.

## Consent and identification

- Identify yourself and the organisation you are calling for, first.
- Confirm you are speaking to the intended party **before** disclosing
  anything about the matter at hand. If the wrong person answers, ask
  for the right one without revealing the details.
- State a bounded purpose. "Calling about purchase order X" is a purpose;
  "following up" is not.
- Stop when asked. A request to speak to a person, or to end the call,
  ends it — and that request is itself a result worth recording.
- Respect calling hours. Make quiet hours a policy setting rather than a
  code path, and be explicit about which timezone it is evaluated in.

## Credentials and sensitive data

The agent must never request, accept, or repeat: passwords, one-time
codes, payment card numbers, bank or routing details, government
identifiers, or health information.

Two controls, not one:

1. **Instruct** the agent not to, in the task text.
2. **Scan** the operator-supplied values interpolated into that task,
   before dispatch, and refuse the call on a hit.

Scan the *interpolated values*, not the rendered task. A task that
correctly instructs "do not collect passwords" contains the word
"password"; a scanner pointed at the whole rendered text flags the
agent's own safety rules and blocks every call you try to make.

Fail closed. A hit blocks the call and escalates to a person — it never
redacts and proceeds, because silently removing half a sentence can
change what the agent asks.

Never write the matched value into an audit log. Record the *name* of
the rule that fired. The log is the thing you are protecting.

## Out-of-scope conversations

Escalate to a human rather than continuing when the call turns to:

- **Commercial commitments** — pricing, discounts, payment terms,
  contract changes, penalties. The agent has no authority to agree, and
  an agreeable-sounding transcript is not consent.
- **Medical, legal or financial advice.** Collecting a fact is not the
  same as advising on one.
- **Emergencies.** An agent must never be positioned between a person
  and emergency services. If a call surfaces one, end the call, escalate
  immediately, and say plainly that this system is not an emergency
  channel.
- **Disputes.** If the recipient disputes the record, the record is the
  thing in question — a human decides, not the caller.

## Scheduling and cancellation

- Nothing dials without passing an eligibility check **and** an attempt
  budget. Both are policy, both are checked immediately before dispatch.
- Gate live calling behind an explicit flag *and* a configured key, so
  no single stray environment variable starts calling people.
- Bound attempts. Three, with a backoff between them, is a reasonable
  default; escalate when the budget is gone rather than dialling again.
- Hold the claim on a workflow under a database row lock from the
  eligibility check through the state transition. Two schedulers that
  both "find work to do" at the same instant will otherwise plan
  overlapping batches — and batches with different membership derive
  different idempotency keys, so the provider cannot recognise them as
  the same work. The result is two real calls to one person.
- Make cancellation reachable: an operator must be able to stop a
  workflow, and a call result arriving afterwards must be recorded as
  history without overwriting their decision.
- Distinguish "not yet due" and "outside calling hours" from real
  refusals. Those resolve themselves, so they must not raise an alert. A
  queue full of false alarms is a queue people stop reading.

## Result handling

- **Never treat a null result as success.** Reconcile, then retry, then
  escalate.
- **No conversation, no evidence.** A recipient the provider never
  reached cannot produce a business outcome, whatever result object is
  attached to them.
- **Re-validate what you are given.** Schema validation guarantees the
  shape, not the meaning. Check enum membership again yourself.
- **Let confidence withhold, never grant.** A low task-level confidence
  may hold back an automatic resolution; a high one must never rescue a
  recipient whose own result is missing or ambiguous.
- **Keep the transcript out of the decision.** Store it as evidence for
  the human reading the audit trail, and drive the decision from the
  structured result — otherwise the wording of a sentence can move
  business state, and the behaviour stops being deterministic.
- **Never overwrite a terminal state.** A late result is history.
- **Record why.** Every decision should carry a stable, machine-readable
  reason code alongside its sentence, so "why did the agent do that?"
  has an answer that was not generated after the fact.

## Testing without calling anyone

Build a simulator that emits payloads in the provider's exact response
shape, so your mapping code is exercised identically whether the bytes
came from the network or from a fixture. A double that returns
pre-normalised objects hides mapping bugs — which are precisely the bugs
a provider integration has.

Run the whole failure catalogue against it: duplicate dispatch, create
timeout, duplicate webhook, lost webhook, null result, unreached
recipient, exhausted budget, concurrent operator edit. None of those
should cost a call credit to test.
