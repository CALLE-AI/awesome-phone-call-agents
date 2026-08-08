# Safety — confidence-gated results

A repair call is a **second phone call to a real person who has already been interrupted once**.
Everything in this document exists to keep that second call rare, justified and bounded.

## The one rule

> A repair call is justified only when the first call produced a genuine conversation **and** the
> missing field genuinely blocks the workflow.

Convenience is not justification. "The dashboard looks nicer with the field filled in" is not
justification. If the workflow can proceed with the field absent, it should proceed with the field
absent.

## Never repair-call in these cases

- **The person declined, refused, or asked not to be contacted.** A confident "no" is a result. A
  repair call after a refusal is harassment with extra steps, and in many jurisdictions it is also a
  do-not-call violation.
- **The call was not answered.** `no_answer`, `busy` and `failed` are reachability problems. This
  skill governs extraction failures, not dialling policy.
- **The conversation was too short to have happened.** A five-second call that ends in `null` is
  someone hanging up. Repairing it means calling back a person who just declined to talk.
- **The person asked to be called back later.** That is an instruction, not a gap. Honour it through
  whatever scheduling the workflow owns; do not fire an immediate repair call.
- **The field is sensitive.** Payment details, government identifiers, health information, passwords
  and one-time codes must never be the target of a repair call. If the missing field is one of
  these, escalate to a human, always.
- **A repair call was already placed for this original call.** One repair, ever. If it also fails,
  escalate.

## Bounds that must hold in code, not in prose

- **At most one repair call per original call.** Enforce with an idempotency key derived from the
  original call id, so a retried workflow cannot place a third call.
- **A repair schema is always a strict subset** of the original required fields. Never widen the ask
  on a second call.
- **No recurring schedules.** This skill creates at most one additional call at the moment it is
  invoked. It never registers a job.
- **A cap on total calls per recipient per workflow run.** Two is the natural cap here; whatever the
  number, it belongs in configuration a human can see.

## Boundaries on the call content

The repair task inherits every boundary the original call had, and adds one: it must open by
referencing the earlier call, so the person is not confused about who is calling and why.

The call must not:

- give medical, legal, financial or emergency advice
- take payment details or read back card, bank or identifier numbers
- attempt to change an answer the person already gave
- imply an obligation, deadline or consequence that was not in the original call
- continue after the person asks to end the call

## Phone numbers and data

- Numbers are E.164 or the workflow stops. Do not guess a country code.
- Mask numbers in logs, notes, summaries and any escalation payload a human will read.
- Samples and documentation use fictional reserved numbers only.
- The evidence trail may contain what a person said. Treat it as customer data: do not paste it into
  tickets, chat messages or commits that are broader-audience than the workflow itself.

## Escalation is not failure

The escalate path exists so the system has somewhere honest to put uncertainty. An agent that
escalates ten percent of calls with a clean evidence trail is more trustworthy than one that
escalates none because it guessed. When in doubt: escalate, attach the trail, and let a person
decide.
