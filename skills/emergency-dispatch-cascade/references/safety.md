# Safety

## Emergency, medical, legal, and financial boundary

This skill is for **non-life-threatening property and service emergencies only**:
plumbing, heating, cooling, and electrical faults that need a technician dispatched
same-day. It must refuse to run, and tell the user to contact 911 or local emergency
services instead, whenever the input describes:

- a gas leak, fire, smoke, or carbon monoxide alarm
- electrical arcing, sparking, or a burning smell
- flooding that endangers people, or any risk of electrocution
- a medical emergency of any kind
- any situation the caller describes as immediately life-threatening

The skill never gives medical, legal, or financial advice, never quotes a binding
price, and never accepts liability language on the business's behalf. The call goal
states the job and asks for availability, ETA, and (for the customer call) a
yes/no confirmation — nothing more.

## One call in flight

Exactly one CALL-E call may be active at a time, for either phase. A second
concurrent call is a bug, not an optimization. This is what makes "stop at the first
acceptance" meaningful: if two technicians were dialled in parallel, both could
accept and the business would need to un-book one of them.

## Reading technician and customer answers conservatively

- A clear "yes, I can take it" plus a stated ETA is an acceptance.
- A clear "no" or "can't make it" is a decline; advance to the next technician.
- No answer, voicemail, or a busy/failed call outcome is treated as a decline for
  cascade purposes (advance to the next technician), but must be logged distinctly
  from an explicit decline so a human reviewing the log can tell the difference.
- Anything else — a maybe, a garbled transcript, a question back, a partial answer —
  is **unreadable**. Halt the cascade, report exactly what was unreadable, and wait
  for a human to say what it meant. Do not guess, and do not advance to the next
  technician while the outcome is still open, because that risks double-booking or
  skipping someone who was actually agreeing.

## Phone numbers

- Technician and customer numbers come only from the business-supplied roster and
  the business-confirmed customer contact. The skill never sources, guesses, or
  completes a phone number.
- All numbers must be E.164 (`+` followed by country code and subscriber number).
- Examples, fixtures, and documentation use only standards-reserved fictional
  numbers (North American Numbering Plan `+1-555-01XX` range). Never use a real
  phone number, including your own, in a committed example.
- Any transcript, call summary, or log surfaced to a human must mask the middle
  digits of a real phone number (e.g. `+1555•••0123`) unless the recipient is the
  number's owner.

## No hidden recurring schedule, no duplicate jobs

- This skill runs exactly once per job: one technician cascade, one customer
  confirmation call. It does not create a recurring schedule, a polling daemon, or a
  follow-up job on its own authority.
- Before starting a cascade for a job, check whether a cascade for the same job is
  already in progress or already ended in an acceptance. Do not start a second
  cascade for a job that already has an assigned technician.

## Cancellation

- The business can stop the cascade at any point between calls. Because only one
  call is ever in flight, stopping is immediate except for the call already ringing,
  which is allowed to complete naturally.
- If the business cancels after a technician has already accepted but before the
  customer confirmation call, the skill must not place the confirmation call, and
  must report that the technician needs to be told the job is cancelled by the
  business directly (this skill does not place a cancellation call on its own).

## Nothing real gets published

No transcript, recording, provider call identifier, or screenshot from a real
CALL-E call belongs in this repository, a pull request, or a demo video — including
with the phone number scrubbed. Demos must use the fixture-based dry-run path in
[`scripts/dispatch-cascade.mjs`](../scripts/dispatch-cascade.mjs), or narrate a real
call without publishing its content.
