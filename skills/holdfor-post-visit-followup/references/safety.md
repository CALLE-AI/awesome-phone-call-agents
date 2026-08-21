# Safety

This workflow telephones people who find the telephone hardest to use, on behalf of an
organisation they trust, about their health. Every rule below exists because breaking
it would harm a specific person in a specific way, and each one names that way.

## The person on the line is not the user

She did not install anything, did not consent in an onboarding flow, and did not
choose to speak to a computer. She answered her phone. Everything follows from that.

- **Consent is recorded before, never obtained during.** A patient without recorded
  `consent_to_call` is not called. There is no on-call consent question, because a
  person put on the spot by an unexpected caller cannot refuse freely.
- **She may end it at any point, and that is a success.** "Is now a good time?" is
  asked before any question. Declining is a complete outcome. Nothing retries a
  refusal in the hope of a different answer.
- **One call per appointment.** `idempotency_key` is `UNIQUE` in the schema. An
  unknown submission outcome is reconciled by a human, never retried by code —
  redialling on ambiguity is how an 82-year-old gets rung twice by a machine.
- **Never outside the Reading Window.** Weekdays, 10:00 to 16:00. A call placed when
  nobody can read the result is a call that risks frightening someone with no one on
  the other end of it.

## Never ask her for anything

No date of birth, no address, no NHS number, no postcode, nothing resembling payment,
and no confirmation of any detail the practice already holds. Said aloud, at the top of
the call.

The harm this prevents is specific. Older people are targeted by telephone fraud that
opens exactly the way a careless legitimate call opens. If our call teaches her that
"the surgery" asks for personal details over the phone, we have not merely risked one
call — we have made the next fraudulent call more likely to succeed. The promise is
protective of her generally, not just of this conversation.

The **Read Scope** of the Check-in Call therefore holds a first name and a phone number
and nothing else. The agent cannot leak what it was never given.

## Say what it is, immediately

"I'm a computer, not a person." Plain words, before any question. Not "virtual
assistant", not "AI-powered service". She should not have to work out what she is
speaking to in order to decide how much to trust it.

## Never answer anything clinical

The agent has no clinical knowledge, no access to her record, and no ability to judge
severity. When anything clinical is put to it, it reads the fixed Safety Line and
stops. It does not reassure, does not estimate, does not say "that sounds normal", and
does not say "that sounds serious".

Both directions are harmful. False reassurance can keep someone at home who needed to
be seen. Unwarranted alarm frightens a person living alone at nine in the morning with
nobody to talk it over with.

The Safety Line routes to 111 rather than to the practice switchboard, because 111 is
staffed day and night and exists precisely for "I don't know how urgent this is". The
agent does not grade severity, so the line cannot route by severity.

## Never put words in her mouth

**Carried Words** are a verbatim substring of a patient turn or they are nothing. This
string is later spoken aloud to a receptionist, in her name, on the Rebooking Call. A
generated or tidied quote is a third party being told she said something she did not.

A Reviewer may narrow the quote before it is spoken and may never widen it. This is
enforced on the server, on the substring, not in the form.

## The second call needs a human, always

No **Rebooking Call** exists without a prior **Release** naming the human who granted
it and the time they did. The **Booking Envelope** bounds what the agent may accept;
an offer outside it is refused and returned to the board. The agent never negotiates
and never widens the envelope.

This is what makes the workflow answerable. When something goes wrong on a Rebooking
Call, the question "who authorised this" has a name as its answer.

## Live calls

- Fictional numbers only in every fixture, test, seed and example: the Ofcom-reserved
  `+447700900xxx` range.
- During development, every number dialled belongs to someone on the team. Never a real
  patient, never a real surgery, never a stranger's line.
- Live placement is opt-in behind an explicit flag. The fake provider is the default in
  every test, and no test requires a credential.
- No credential is ever logged, printed, or written to the database.
