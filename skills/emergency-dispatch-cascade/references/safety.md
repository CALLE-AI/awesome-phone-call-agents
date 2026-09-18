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

## Live dispatch is advisory until a human confirms it

A heuristic match on the words in a transcript, and a call transport that finished
with status `COMPLETED`, are both signals that a human should look at — neither one
by itself is proof that a technician actually committed to the job. `COMPLETED`
means the call finished normally; it does not mean the content of the call was a
firm yes. For that reason, live dispatch must never auto-book:

- An acceptance detected on a **live** call is reported as an advisory
  `advisory_acceptance`, not a booking, and the customer confirmation call (Phase 2)
  must not run until a human operator explicitly confirms it.
- The ETA used for the booking and for the customer call must come from that human
  confirmation, not from a fixture value or an unvalidated field in the call
  transport's response. Never reuse a dry-run fixture ETA as a live result.
- If the operator does not confirm, the run must end with nobody booked and no
  customer call placed — reported distinctly from both "declined" and "exhausted."
- This gate applies to live calls only. The dry-run path may keep its automatic
  fixture-to-fixture pipeline, since nothing there has a real-world effect
  ("fake-only" automation is acceptable; real automation is not).

## Phone numbers

- Technician and customer numbers come only from the business-supplied roster and
  the business-confirmed customer contact. The skill never sources, guesses, or
  completes a phone number.
- All numbers must be E.164 (`+` followed by country code and subscriber number).
  The reference script validates this and refuses to run otherwise.
- Every technician and the customer must be a distinct destination. A number reused
  across two roles (or two technicians) is rejected before any call is placed —
  it is far more likely to be a data error than an intentional dispatch.
- Examples, fixtures, and documentation use only standards-reserved fictional
  numbers (North American Numbering Plan `+1-555-01XX` range). Never use a real
  phone number, including your own, in a committed example. Live mode refuses to
  dial anything in that reserved range, so a fixture accidentally left in a live
  job file fails closed instead of ringing nobody.
- Live mode requires the operator to pass `--live` and `--confirm-live` together, as
  the explicit per-run intent check that every destination in the job file is a
  real, authorized recipient. `--live` alone is refused.
- Any transcript, call summary, or log surfaced to a human must mask the middle
  digits of a real phone number (e.g. `+1555•••0123`) unless the recipient is the
  number's owner. This includes subprocess/CLI error output, which can otherwise
  echo a raw `--to-phone` argument back into a log or terminal; the reference
  script masks phone numbers in every error it raises.
- A live call's raw transcript is withheld from the script's own log output
  entirely (not merely number-masked), since it may contain real, unredacted
  speech beyond the phone number itself. Only the authored dry-run fixtures are
  safe to print in full, because they are not real.

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
