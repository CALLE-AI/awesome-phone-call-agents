# Safety boundaries for medical-adjacent phone workflows

A phone agent asking a pharmacist about a medication sits close to several lines
it must not cross. These rules are written for the pharmacy stock-check skill
but apply to any health-adjacent calling workflow.

---

## The agent gathers information; it does not advise

**In scope:** whether a named medication is in stock, how many units, price,
whether a prescription is required, whether they will hold it, what the
pharmacist said about alternatives.

**Out of scope:** whether the user should take the medication, whether an
alternative is equivalent, dosage guidance, interaction checks, or anything
resembling clinical judgement.

When a pharmacist suggests an alternative, report it as reported speech — *"the
pharmacist mentioned they stock X"* — not as a recommendation. The distinction
matters because a user acting on a substitute suggested by an automated system
has been given advice nobody qualified reviewed.

---

## Never transact

The agent does not order, reserve, pay for, or commit to collecting anything.
"Can you hold it?" is a question. "Please hold it" is a commitment, and the
agent is not authorised to make one.

If a pharmacist offers to set stock aside, record the offer and its duration.
Let the user decide.

---

## Not for emergencies

A phone agent working through a list takes minutes per call. Someone who needs
medication urgently should not be waiting on it.

If the request suggests urgency — a missed critical dose, an acute reaction,
distress — say plainly that this workflow is not appropriate and point toward
emergency services or urgent care. Do not start calling.

---

## Prescription requirements are reported, never circumvented

If a medication requires a prescription, that fact is part of the result. The
agent must never suggest a way around it, ask a pharmacist to dispense without
one, or imply the user has a prescription they have not confirmed.

---

## Uncertainty must survive to the user

The user may travel somewhere while unwell on the strength of a result. That
raises the cost of overconfidence well above the usual.

- **Gate on completion before reporting anything.** A call that failed, hit
  voicemail or was cut off can still carry a partially filled summary. If
  `task_completed` isn't true and the run didn't reach `COMPLETED`, emit no
  stock fields at all — report that the pharmacy could not be reached.
- **Verification must outrank stock status in any ranking.** A low-confidence
  "yes" appearing above a high-confidence "no" is the specific failure that
  sends a sick person on a pointless journey. Rank verified results first,
  then by stock.
- Surface the confidence score. Do not average it away or hide it behind a tick.
- Show low-confidence results as needing verification, not as facts.
- Offer the transcript. Everything reported should be checkable against what was
  actually said.
- "Could not be reached" is a distinct outcome from "not in stock". Never
  collapse them.

## A dry run must not transmit anything

If a workflow advertises a dry run, that has to mean nothing leaves the machine
— no credentials read, no socket opened, no payload sent.

Calling a planning or validation endpoint during a "dry run" transmits the
recipient's phone number and, here, the medication someone is looking for. That
is health-adjacent information about an identifiable person going to a third
party, from a mode the user was told was inert. Validate and print locally
instead.

---

## Privacy

- Callers are told immediately that they are speaking to an automated
  assistant.
- Do not state the patient's name, condition, or any identifying detail to the
  pharmacy. The medication and quantity are all that's needed.
- Mask phone numbers in summaries and logs — pharmacy name plus last four
  digits.
- Transcripts contain a third party's voice. Store them under a retention policy
  and do not publish them.

---

## Calling businesses responsibly

- Identify as automated in the opening line, before asking anything. This is
  both the ethical default and the practical one — it materially improves the
  chance a pharmacist engages.
- Keep calls short. A pharmacist is working.
- One call per pharmacy per request. Retries are for no-answer, not for a
  better answer.
- Respect business hours for the recipient's region.
- Accept "no" and end the call.

---

## No hidden recurring work

This is a one-shot workflow. If a user wants a repeated check:

- create the schedule explicitly, on request
- state clearly how many calls it will place and how often
- tell the user how to cancel, in the same message
- never create a schedule as a side effect of a one-off request

---

## Cost is a safety property

Calls cost money and free allowances are small. A workflow that silently spends
a user's balance has harmed them.

- Count phones, not plans — one batch can spend N calls.
- Check the budget for the whole request before dialling anything.
- Default to dry-run; require an explicit flag for live calls.
- Never re-dial to recover data already paid for.
