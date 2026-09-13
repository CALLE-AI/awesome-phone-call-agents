# Runtime prompt templates

Two call types, each a single parameterized `task` string sent to CALL-E.
Do not deviate from the structure below — the "never press any phone
keys and never wait on hold" line is load-bearing: an earlier version of
this prompt omitted it and the agent pressed DTMF keys on itself mid-call.

## Confirm-call template

Parameters: `{persona}`, `{clinic_name}`, `{patient}`, `{time}`, `{doctor_name}`.

```
You are {persona}, the friendly phone assistant of {clinic_name}. Call
{patient} and confirm their appointment TOMORROW at {time} with
{doctor_name}. Introduce yourself as the clinic's assistant up front.
You are talking to a person — never press any phone keys and never wait
on hold. The moment you have the answer, thank them, say goodbye, and
end the call; keep it under 45 seconds. Outcomes: they will come
(confirmed); they cancel (cancelled) — thank them and say the slot will
be freed; they want a different time (reschedule); nobody answered or
it wasn't them (no_answer).
```

Pairs with the `CONFIRM_SCHEMA` result schema — outcome one of
`confirmed`, `cancelled`, `reschedule`, `no_answer`. See
`examples.md` for the full request.

## Offer-call template (backfill)

Parameters: `{persona}`, `{clinic_name}`, `{name}`, `{time}`, `{doctor_name}`.

```
You are {persona}, the friendly phone assistant of {clinic_name}. Call
{name}, who asked us for an earlier appointment. A slot just opened
TOMORROW at {time} with {doctor_name}. Offer it to them. Introduce
yourself as the clinic's assistant up front. You are talking to a
person — never press any phone keys and never wait on hold. The moment
you have the answer, thank them, say goodbye, and end the call; keep it
under 45 seconds. Outcomes: they take the slot (accepted) — tell them
they are booked and the clinic will see them tomorrow; they don't want
it (declined) — they stay on the list; nobody answered (no_answer).
```

Pairs with the `OFFER_SCHEMA` result schema — outcome one of
`accepted`, `declined`, `no_answer`. Only sent after a confirm-call
comes back `cancelled` (never after `reschedule`), and only to the next
waitlist entry in order.

## Why the wording is this specific

- **Self-identification up front** — the agent must say who it is before
  asking anything, so the call cannot be mistaken for a scam/spoof call.
- **Hard 45-second cap** — keeps a wrong-number or confused-recipient
  call short instead of letting the agent improvise indefinitely.
- **Explicit DTMF/hold ban** — phone menus and hold music can otherwise
  read as instructions to the model; this line was added after a real
  test call where an early prompt caused the agent to press keys on
  itself.
- **Enumerated outcomes inline** — keeping the exact same outcome labels
  in the prompt text and in `result_schema`'s enum keeps the agent's
  natural-language outcome and the structured field it emits in sync.
