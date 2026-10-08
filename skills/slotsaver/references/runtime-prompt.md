# Runtime prompt templates

Two call types, each a single parameterized `task` string sent to CALL-E.
Do not deviate from the structure below — the "never press any phone
keys and never wait on hold" line is load-bearing: an earlier version of
this prompt omitted it and the agent pressed DTMF keys on itself mid-call.

## Confirm-call template

Parameters: `{persona}`, `{clinic_name}`, `{patient}`, `{time}`, `{doctor_name}`.

```
You are {persona}, the friendly phone assistant of {clinic_name}. Call
{patient} and first confirm you are speaking with {patient} — if the
person on the line says they are someone else, or you cannot tell who
you are speaking with, do not discuss the appointment; end the call
politely (wrong_person_or_unclear). Otherwise, confirm their
appointment TOMORROW at {time} with {doctor_name}. Introduce yourself
as the clinic's assistant up front. You are talking to a person — never
press any phone keys and never wait on hold. The moment you have the
answer, thank them, say goodbye, and end the call; aim to keep it under
45 seconds. Outcomes: they will come (confirmed); they cancel
(cancelled) — thank them and say the slot will be freed; they want a
different time (reschedule); nobody answered (no_answer); you reached
someone but could not confirm it was {patient}, or the call was too
ambiguous to classify (wrong_person_or_unclear).
```

Pairs with the `CONFIRM_SCHEMA` result schema — outcome one of
`confirmed`, `cancelled`, `reschedule`, `no_answer`,
`wrong_person_or_unclear`. See `examples.md` for the full request.

## Offer-call template (backfill)

Parameters: `{persona}`, `{clinic_name}`, `{name}`, `{time}`, `{doctor_name}`.

```
You are {persona}, the friendly phone assistant of {clinic_name}. Call
{name}, who asked us for an earlier appointment, and first confirm you
are speaking with {name} — if the person on the line says they are
someone else, or you cannot tell who you are speaking with, do not
offer the slot; end the call politely (wrong_person_or_unclear).
Otherwise, tell them a slot just opened TOMORROW at {time} with
{doctor_name} and offer it to them. Introduce yourself as the clinic's
assistant up front. You are talking to a person — never press any phone
keys and never wait on hold. The moment you have the answer, thank them,
say goodbye, and end the call; aim to keep it under 45 seconds.
Outcomes: they take the slot (accepted) — tell them they are booked and
the clinic will see them tomorrow; they don't want it (declined) — they
stay on the list; nobody answered (no_answer); you reached someone but
could not confirm it was {name}, or the call was too ambiguous to
classify (wrong_person_or_unclear).
```

Pairs with the `OFFER_SCHEMA` result schema — outcome one of
`accepted`, `declined`, `no_answer`, `wrong_person_or_unclear`. Only
sent after a confirm-call comes back `cancelled` (never after
`reschedule`), and only to the next waitlist entry in order.

## Handling results that aren't a clean match

A call result only ever falls into one of three buckets: a clean match
against the schema, a `wrong_person_or_unclear` outcome, or a result
that's missing/malformed entirely (CALL-E reports the call `completed`
with no `outcome` field, an `outcome` outside the enum, or the call
never reaches `completed` at all — errors out, or the client wait
budget is exhausted first). The first is handled per the outcome
tables above. The other two are **not** the same as `no_answer` and
must not be folded into it:

- `no_answer` means CALL-E told us, in the structured result, that
  nobody picked up. It is the only outcome that gets one automatic
  retry.
- `wrong_person_or_unclear` and a missing/malformed result both mean we
  genuinely don't know what happened on the call — reaching the wrong
  person, an ambiguous conversation, and "we can't tell" are the same
  failure mode as an outright missing result: absence of evidence, not
  evidence of no-answer or of cancellation. Treat all of these the same
  way: stop processing that appointment/waitlist entry, do **not**
  auto-retry as if it were `no_answer`, do **not** free the slot or
  advance to the next waitlist entry as if it were `cancelled`, and
  flag it NEEDS-ATTENTION for a human to reconcile (listen to the
  recording/notes, call back personally, or explicitly confirm the
  real outcome).
- Even a clean, schema-valid result is only a **proposed** outcome. A
  schema match plus the model's own claim that it confirmed the
  recipient's identity is not enough to change a real appointment or
  waitlist record. A real state change (CONFIRMED, slot freed, slot
  backfilled) needs both:
  1. **Recipient evidence**: CALL-E's call record shows the call
     connected to the exact number on file for that appointment or
     waitlist entry. A model-written `notes` field doesn't count as
     evidence on its own.
  2. **Human confirmation**: an operator reviews the proposed outcome
     against that evidence (and the call's notes or recording, where
     available) and explicitly approves it before the clinic's real
     schedule is written.
  Until both happen, the outcome stays a pending proposal and the real
  record doesn't change.
- **Mock-only scope:** in this skill and its reference implementation,
  state changes are applied automatically only to fictional demo data
  (a scripted mock caller and a demo board). It isn't connected to any
  real clinic schedule, and nothing here writes a real appointment
  change without the human confirmation step above. Every
  "mark CONFIRMED / free the slot / slot filled" effect in
  `examples.md` is a mock-only illustration of the proposed outcome.

## Why the wording is this specific

- **Self-identification up front** — the agent must say who it is before
  asking anything, so the call cannot be mistaken for a scam/spoof call.
- **Identity check before any appointment detail** — asking "am I
  speaking with {patient}/{name}?" before discussing the appointment is
  what makes `wrong_person_or_unclear` possible to detect at all; without
  it, a wrong-number pickup can otherwise be misclassified as a genuine
  confirm/cancel/accept/decline.
- **Target 45-second call length** — an instruction inside the prompt
  asking the model to keep the call short once it has an answer. It is
  not a server- or client-enforced cutoff; nothing outside the model
  following this instruction forcibly ends the call at 45 seconds. The
  only actually enforced timeout is the CALL-E client wait budget
  (`CALLE_TIMEOUT_SECONDS`, default 300s in the reference
  implementation).
- **Explicit DTMF/hold ban** — phone menus and hold music can otherwise
  read as instructions to the model; this line was added after a real
  test call where an early prompt caused the agent to press keys on
  itself.
- **Enumerated outcomes inline** — keeping the exact same outcome labels
  in the prompt text and in `result_schema`'s enum keeps the agent's
  natural-language outcome and the structured field it emits in sync.
