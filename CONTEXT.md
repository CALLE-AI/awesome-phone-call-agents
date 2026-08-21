# Post-Visit Follow-Up

A practice-operated phone workflow that rings older patients after an appointment,
returns bounded structured answers, and — only after a named human releases it —
places a second call into the practice's own booking queue on the patient's behalf.

## Language

### The parties

**Practice**:
The clinical organisation that operates the workflow and holds the existing care
relationship with the patient. Owns both calls; the customer.
_Avoid_: clinic, surgery, provider, tenant

**Patient**:
The person the Check-in Call rings. Always an adult with an existing care
relationship with the Practice.
_Avoid_: user, customer, elder, service user, caller

**Reviewer**:
A named member of Practice staff who reads a Review Item and either releases it
or closes it. Never anonymous — a Release always records who.
_Avoid_: admin, approver, operator, clinician

### The two calls

**Check-in Call**:
One outbound call from the Practice to the Patient after an appointment, asking a
fixed set of bounded questions at the Patient's pace.
_Avoid_: follow-up call, wellbeing call, call A, outbound call

**Rebooking Call**:
One outbound call from the Practice to the Practice's own booking line, placed on
the Patient's behalf, that carries the Carried Words into the queue. Exists because
the Practice's booking system is reachable only by phone.
_Avoid_: booking call, callback, call B

**Queue Absorption**:
The reason the Rebooking Call is a call and not a database write. The hold time is
not removed; it is served to an agent instead of to the Patient.
_Avoid_: automation, deflection, bypass

### The gate between them

**Review Item**:
The durable record produced by one Check-in Call, holding its bounded answers, its
flags, and the transcript evidence for each. The unit that appears on the board.
_Avoid_: ticket, task, alert, handoff

**Release**:
The act by which a named Reviewer authorises a Rebooking Call for one Review Item.
A Release is a bounded authority, not an approval flag: it carries the Booking
Envelope and the exact Carried Words that may be spoken. No Rebooking Call may
exist without a prior Release.
_Avoid_: approve, sign-off, handoff, escalate

**Booking Envelope**:
The set of offers a Reviewer has authorised the agent to accept on the Rebooking
Call — date range, time of day, appointment mode, clinician constraint. An offer
inside the envelope is accepted; anything outside is refused and returned to the
board. The agent never negotiates and never widens the envelope.
_Avoid_: preferences, criteria, rules, constraints

**Stop Condition**:
A surface condition — not a judgement — that ends the Check-in Call early: a phrase
on the red-flag list, an answer that cannot be mapped to a bounded field, repeated
confusion, a third party on the line, or a clinical question asked of the agent.
The agent matches; it never grades severity.
_Avoid_: escalation, red flag, trigger, urgency

**Never-Ask Rule**:
The Check-in Call asks the Patient for no identifying detail, no address, no date
of birth and nothing resembling payment, and says so aloud. A call that asks an
older person to confirm personal details is indistinguishable from a scam, so the
call that cannot ask is the only one that can be trusted. Identifiers needed by
reception are supplied by the Rebooking Call, never obtained from the Patient.
_Avoid_: verification, identity check, authentication

**Safety Line**:
The single fixed, human-authored sentence the agent reads when a Stop Condition
fires. Never improvised, never varied by the model.
_Avoid_: fallback, disclaimer, script

**Reading Window**:
The hours during which a flagged Review Item will be read by a Reviewer the same
day. No Check-in Call is placed outside it. The schedule is bound to human
availability, not to what would suit the Patient — a call nobody can catch the
result of should not be made.
_Avoid_: calling hours, business hours, schedule

**Carried Words**:
The Patient's own verbatim quote that travels from the Check-in Call into the
Rebooking Call, so the Patient never has to explain the same thing a third time.
A span taken from the transcript, never generated prose; the Reviewer sees the
exact string that will be spoken.
_Avoid_: context, summary, notes, payload

**Read Scope**:
The named set of Patient fields one call is permitted to know. Each call has its
own — the Check-in Call takes appointment-scoped fields and a first name; the
Rebooking Call additionally takes the identifiers reception needs to find the
Patient. Neither ever includes clinical detail.
_Avoid_: patient data, context, payload, profile

### Inside the Rebooking Call

**Offered Slot**:
What reception actually put on the table, held as the turn she said it in rather than
as a resolved date. "Tuesday the 26th at ten past nine" is an Offered Slot; the
matcher reads day and clock tokens out of that turn and never converts it into a
calendar date. See [ADR 0008](docs/adr/0008-an-offered-slot-is-matched-never-resolved.md).
_Avoid_: appointment, slot, booking, proposed time

**Envelope Match**:
The deterministic re-reading of an Offered Slot against the Booking Envelope, run
after the call ends and never during it. The agent's acceptance is what keeps the
conversation human; the Envelope Match is what makes the boundary real. A match
outside the envelope flags the item and names the slot.
_Avoid_: validation, verification, check

**Practice Hours**:
The window a Practice books inside, about 08:00 to 18:30, used to read a bare clock
time without inferring anything. "Half four" is 16:30 because 04:30 is not on offer.
A time outside Practice Hours is flagged, never assumed.
_Avoid_: opening hours, business hours, working day

**Reception Outcome**:
How the Rebooking Call ended in words, as a closed enum anchored to the turn that
carried it: a slot offered, a third-party booking refused, no slots available, or
unclear. Distinct from the platform's outcome, which describes how the call ended
rather than what was said in it.
_Avoid_: result, disposition, call outcome

**Booked**:
The terminal status of a Review Item whose Rebooking Call accepted an Offered Slot
that passed the Envelope Match. Distinct from `closed`, which is a human deciding no
call was needed. Collapsing the two makes the board's daily ratio unreadable.
_Avoid_: complete, done, success, resolved

**Spoken Sources**:
The three things the Rebooking Call is permitted to say aloud: the Practice's own name,
the contents of the Release, and the Patient's identifiers. A whitelist, not a list of
prohibitions. Anything outside it gets one fixed sentence and the call returns to
scheduling. See [ADR 0011](docs/adr/0011-the-rebooking-call-speaks-from-a-closed-list.md).
_Avoid_: allowed topics, script scope, guardrails

**Binding Acceptance**:
The last offer the agent accepted on a Rebooking Call, and the only one the Envelope
Match reads. Reception revises, so acceptance is plural and the earlier offers are kept
as evidence rather than overwritten — a withdrawn 09:10 is the reason a booking reads
08:50. See [ADR 0012](docs/adr/0012-the-last-acceptance-binds-and-every-offer-is-kept.md).
_Avoid_: the accepted slot, final offer, confirmation

## Flagged ambiguities

**"Handoff" is taken.**
`skills/human-context-handoff/` uses *handoff* for an agent ringing a human to ask
one bounded question — the opposite direction of travel. In this context the human
gate is a **Review Item** plus a **Release**. Do not use *handoff* for either.

**Read Scope is per-call, not per-Patient.**
"What the agent knows about Margaret" is not a single answer. The Rebooking Call
knows her surname and date of birth because reception asks for them; the Check-in
Call deliberately does not, because a call that asks an older person to confirm
personal details is indistinguishable from a scam.

**"Follow-up" is overloaded.**
In clinical use a follow-up is a further appointment. Here the calls are the
Check-in Call and the Rebooking Call; the appointment they may produce is a
follow-up appointment. Never call either call "the follow-up".

**"Declined" names three different events.**
The platform says `DECLINED` when a Patient hangs up on the Check-in Call, and again
when the Practice's switchboard rejects the Rebooking Call. A receptionist refusing a
third-party booking is neither: that call completes cleanly and the refusal exists only
in what she said. The board keeps them apart as `declined`, `not_reached` and
`reception_declined`. See [ADR 0010](docs/adr/0010-a-rebooking-outcome-is-not-a-checkin-outcome.md).
