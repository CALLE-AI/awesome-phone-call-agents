# Scope and limits

Read this before pointing the app at anything that matters.

## It is not a relay service

Telecommunications Relay Service is the regulated service, required in the United
States under Title IV of the Americans with Disabilities Act, where a
communications assistant relays a live conversation between somebody who is deaf,
hard of hearing or has a speech disability and a hearing party. The person is on
the call. They say what they want to say and the assistant relays it.

This app does none of that. It runs one delegated errand, from a script the person
approved beforehand, while they are not on the call. It is useful for the same
reason a relay service is useful and it replaces none of it. When a conversation
needs to happen, use a relay service.

## It never claims to be a person

The first sentence of every call says it is an automated assistant calling on
behalf of a named person with their permission and that it is not a person. If it
is asked whether it is a person, the script tells it to say no plainly. There is no
mode that turns that off. An app that lets you impersonate somebody by phone is a
fraud tool, not an accessibility tool.

## The callee is allowed to refuse

Plenty of businesses will not deal with an automated caller. The app detects that,
records `callee_declined_automated`, thanks them, ends the call and tells the
person to call another way. It does not argue, retry or dial back with a different
script. A refusal is an answer.

## It does not discuss clinical, legal or financial detail

The script forbids describing symptoms, conditions, treatment or money, and
forbids agreeing to any payment. The disclosure budget refuses card numbers and
passwords outright. Administrative errands are in scope: book, confirm, reschedule,
ask what to bring, ask whether a plan is accepted, ask whether something arrived.
Anything that needs judgment about a person's health, rights or money is not.

That boundary lives in the script, so it holds for what the caller volunteers. It
cannot hold for what somebody writes into `goal.summary` or a question, because
that text is read out as written. Those two fields are scanned for clinical, legal
and financial wording and any hit is shown in the preview before consent, which is
a prompt to reread the sentence and not a filter. Why the call was delegated is
never sent at all.

Never use this app for an emergency. It places one call, waits and reports
afterwards. If somebody needs help now, call emergency services directly.

## It commits to nothing it was not authorized to commit

`goal.commitment` is the whole authority the caller has. `none` means it may agree
to nothing. `slot_within_windows` means it may accept a time only inside the listed
windows and a time outside them comes back as a proposal with nothing agreed.
`confirm_existing` means it may confirm what already exists and may not move or
cancel it.

If the extracted result says a time was accepted and that time is outside the
windows, the report marks `outside_authorized_window` and tells the person to check
and cancel it. The app does not hide its own mistake behind a success message.

## It reports only what the transcript supports

The structured result from the model is a proposal. The transcript is the evidence.

An answer is reported when a turn from the callee supports that specific question.
The report prints the turn it stands on. Every answer shape is anchored to its
question: the caller must have asked it in the transcript. The supporting turn
must be one of the two callee turns after it. That holds for text and datetime
answers as much as for a yes or a no, because "Thursday at nine forty" said while
discussing something else is not an answer to a question nobody asked.

An agreement is reported when the transcript shows somebody agreeing to the thing
the report would print. It is anchored twice: to the turn where the caller raised
the arrangement, plus to the time itself, which has to have been named by the moment
the callee spoke, either in the agreeing turn or in the caller's proposal before it.
Booking language on its own proves nothing. An
agreement about some other time reads `unconfirmed`, not `committed` and not
`outside_authorized_window`, because both of those would print or act on a time off
the extraction alone. The note quotes what they did say, so nobody reads
`unconfirmed` as nothing having happened. Any confirmation code goes with the
agreement.

Both bindings look backwards only. A turn is evidence for what it was answering.
Nothing said after it can be that. A caller who proposes Wednesday, hears no, then
proposes Thursday has not been refused Thursday. A callee who reads out a second
reference number after agreeing to the first appointment has not given that number for
this one. The cost is a call where the only precise form of the time or the reference is
in a later turn: that reads as not named, so the report gives less than the extraction
claimed rather than more.

Raising the arrangement takes two things at once and not one word. The turn has to be
about the arrangement, which is booking language or the time the extraction reported. It
also has to put that to the callee, which means an ask or an actual proposal: a question,
a request or a time they could say yes to. A statement that only carries the word
appointment, confirm or availability raises nothing. "This appointment is for next week",
said between a question and its answer, would otherwise make that answer a reply to the
arrangement, so a no to the insurance question would come back as a refused appointment.
One rule, used by all three bindings, so it cannot hold on the agreement and not on the
refusal or the confirmation code. A caller who proposes a time without asking a question
is still proposing, so "Thursday the thirteenth at nine forty would suit her" is an anchor
and the tightening does not cost real agreements. It fails closed the other way: an ask
this does not catch leaves the evidence unbound, so the commitment reads
`unconfirmed`.

The time is matched as a wall clock, in the forms a transcript carries. When a turn
names a day or a weekday it has to be the claimed one, so the same time on another
authorized day is not reported as this one. A turn that names no day is taken as the
day the caller had already established.

Everything else the report prints off the extraction is held to the same standard. A
confirmation code has to have been read out by the time the agreement was made or the
report drops it and says it did. A time no callee turn named is not read back as an
offer, so the
next step says "another time" rather than a time nobody said. An agreement with no
time at all cannot be checked against the windows, so it reads `unconfirmed` too.
CALL-E's own note is printed with its name on it, because nothing here checked that
sentence. A reported refusal is held to the same standard as a reported agreement:
`declined_by_callee` needs either a turn that refuses the arrangement or the business
refusing to deal with an automated caller at all. Without one the commitment reads
`unconfirmed` and the next step says nothing is settled either way, because telling
somebody their errand was turned down is a claim about their errand and not a
formatting choice. With one, the note quotes the turn. Either way a refusal does not
settle the errand: a booking that was refused is not a goal met, so the outcome is
`partially_met` at best.

A refusal is bound the same two ways an agreement is, because refusal words prove
nothing on their own. "No, we do not take that plan" refuses a question and says
nothing about the booking, which may have been held in the same call. So the turn has
to be answering the arrangement: what the caller last put to the callee before it has
to be the arrangement rather than one of the questions. Statements do not change the
subject. A caller reading out a date of birth between the two leaves the refusal
answering the appointment it followed. So does a statement that only mentions the
appointment. Then the time is bound too. When the extraction
reports a datetime, that datetime has to have been named by the moment the callee spoke,
in the refusing turn or in the caller's proposal before it, which is what the agreement
side already requires. Two times
proposed on one call is otherwise a way for a no to one of them to be read as a no
to the other in either order. It is also a way for either to be read as a no to the
errand. A refusal aimed
somewhere else is quoted in the
report as what was actually turned down, so `unconfirmed` never reads as nothing
having been said.

When the extraction reports no time there is nothing to bind to, so the prompt anchor
stands alone. That is the same asymmetry on the agreement side, where an agreement with
no time cannot be held against the authorized windows either and reads `unconfirmed`.
The time binding fails closed. `offered_datetime` is contracted as the time that was
agreed or offered, so on a refused errand it can name a time that was discussed rather
than the one that was turned down. Where it does, the refusal reads as being about
something else, the commitment comes back `unconfirmed` and the note quotes the refusal.
That says less than the call held, which is the direction to be wrong in: a real refusal
reported as unsettled costs a phone call to check, a refusal of one option reported as a
refusal of another costs somebody a slot that still stands.

When both claims have a turn behind them, one agreeing and one refusing the same
arrangement, the report stands behind neither. The commitment reads `unconfirmed`,
the note quotes both turns and the next step says a person has to read the transcript
and call, because reporting the agreement would book something the callee took back
and reporting the refusal would drop a slot they may be holding. A confirmation code
belongs to an agreement that stands, so it is dropped there too.

The refusal patterns are narrow on purpose. Missing a real refusal costs a softer
report that says the outcome is unknown. Inventing one costs the person a fact about
their own errand, so the checks are built to be wrong in the first direction.

When nothing supports the claim, the report says not answered or `unconfirmed` and
notes that CALL-E claimed otherwise. It will sometimes be too strict, in two ways.
The checks compare words, so a paraphrase they cannot see reads as unsupported. And
the window is two turns, so an answer the callee circles back to four turns later
reads as unsupported as well. That is the direction to be wrong in. A report that
says less than the extraction claimed costs a phone call to check. A report that
says more is how somebody misses an appointment they were told was booked.

## When nobody knows what happened

A create or a poll can fail in a way that leaves the state of the call unknown: a
lost connection, a timeout, a server error. The call may be ringing right now.

In that case the app reconciles under the same idempotency key first, which returns
the existing call rather than placing a second one. If it still cannot read the
call, the outcome is `outcome_unknown` with exit code 40. Getting the call back is
the only thing that settles it. A refusal to the reconciliation, a definite one such
as 401 or 402 included, can be decided before the idempotency lookup ever happens,
so it says nothing about the request that went unanswered and the call stays
unknown. The report says the outcome is not known instead of saying nothing was
said. Running the same errand file again reads the same call back, because the key
covers the content of the call. Editing the file first makes it a different call, so
the next step says not to.

A call CALL-E has not finished with lands in the same place. Only a terminal status
is read as a result: `completed`, `failed` or `canceled`, which is every terminal
value in the SDK's own `CallStatus`. A no answer or a voicemail arrives as `failed`
with a failure code or as a completed call whose transcript is a machine, so neither
needs a status of its own. A call that is still `queued` or `in_progress` when the timeout runs
out has a transcript that is still being written, so the app reports
`outcome_unknown` with `call_status` unknown and the call id kept. It states no
verdict, no commitment and no privacy finding. Reading a call in flight as a result
is how a call still ringing gets reported as an errand that is done. The next step
is the same: run the same errand file again and it reads that same call back.

A refusal on the first attempt is different. CALL-E declined to create the call and
nothing was placed, so the outcome is `api_error` and the report can say so plainly.

A call that ended before the conversation did is the other way round. `failed` and
`canceled` are terminal, so there is a transcript to read. A line that dropped after
the slot was held carries the whole errand: the questions, the answers and the
agreement. That status is not read as nobody having answered. What was said comes
from the transcript and the notes name the status as `call_failed` or
`call_canceled` with the failure code beside it. The outcome is never `goal_met`,
because a call that ended early may have been cut off partway through. A call with
nobody on its transcript is still read from its failure code, which is where
`voicemail` and `not_reached` come from.

## Who you may call

Call a business, on a number it published, about business the person asked for.

The FCC ruled on February 8 2024 that "calls made with AI-generated voices are
'artificial' under the Telephone Consumer Protection Act", which holds them to the
same rules as any other artificial voice. Those rules are about calls to consumers
and this app cannot tell a business line from a personal one. That judgment stays
with whoever runs it, which is why `callee.published_source` is required: writing
down where the number came from is a small brake worth having.

## Consent is the person's and it is recorded

The errand file is the consent record: who is delegating, why, what may be said
about them and what may be agreed. `preview` prints the exact script and the
disclosure list so they can read it before anything rings. It ends with a receipt: a
short hash of the errand file as the app parsed it, together with the exact call
that would be sent. Everything the preview prints is inside that hash, including
`reason_for_delegation`, which is hashed here and still never sent to CALL-E. A test
walks the labelled lines of the preview and fails if one of them is not covered.

`call --live` will not run without that receipt. A missing one is a usage error and
a stale one names the file as changed and refuses. Nothing is sent either way. So
consent belongs to a preview somebody actually read. Editing the errand file after
reading it invalidates the consent instead of quietly riding on it.

That is as far as it goes. The app cannot tell whether the person named in the file
agreed to any of this. The receipt binds the consent to a script, not to a person.

## What it stores

The report holds the answers, the disclosure record, the privacy findings, the
CALL-E call id and the full transcript, written with mode `0600`. A mode passed to a
write only applies when the file is created, so the mode is set on the open
descriptor with fchmod: a report written over a file somebody had left at `0644`
comes back `0600`. A path that is not a regular file is refused instead of
followed. The transcript is kept on purpose: a person who could not hear the call is
entitled to what was said on their behalf. Phone numbers are masked. Findings are
masked.

Nothing is sent anywhere except CALL-E and the API key is read from the environment
only. The base URL is checked before the client that carries the key is built, and
the check is the host, not the scheme: `https:` says the transport was encrypted and
says nothing about who is on the other end. The host has to be `api.heycall-e.com`,
or `localhost`, `127.0.0.1` or `::1` for the local fake, which is the only place
plain HTTP is allowed. Any other host has to be named exactly in
`CALLE_ALLOWED_HOSTS` or with `--allow-host`, so a lookalike such as
`localhost.attacker.example` is refused: the comparison is the whole hostname
lowercased, never a suffix. The refusal names the flag and the environment variable
that set it. The key stays where it is.

## Where it will disappoint you

- One call, one errand. It does not chase, escalate or call back later.
- It does not navigate long phone menus well. If a line is an eight level menu,
  expect `voicemail` or `not_reached`.
- It reads what came back. If a receptionist was vague, the report says the
  question was not answered rather than guessing what they meant.
