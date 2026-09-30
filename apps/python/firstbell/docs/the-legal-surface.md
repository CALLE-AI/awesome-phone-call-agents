# The legal surface

Seven questions a school district's counsel would ask before this software telephoned a
single parent. Some have an answer in this repository, some have a design position, and some
are open. They are written down because silence about them reads as never having asked.

Not among the seven: COPPA. It covers an operator of an online service directed to children
collecting personal information from a child under 13, and this software does not do that. It
telephones an adult, it asks nothing of a child, and if a child answers the instruction is to
say only that the school will call back and end the call
(`firstbell/domain.py`, `build_task`). Named here because a summary of this document listed
it for a fortnight and the document never mentioned it, which is worse than either
answering it or leaving it out.

This is not legal advice and it is not a compliance sign-off. It is the list of questions a
district's counsel would ask before this software phoned a single parent, written down so
that a reader can see which ones have an answer here, which ones have a design position, and
which ones are open. Every one of them is a question about a school telephoning a family,
not a question about this code, which is why none of them is answered by the tests.

The order is the order they would be asked in.

## 1. Is an absence call a disclosure of an education record? (FERPA)

**The rule.** FERPA (20 U.S.C. § 1232g; 34 CFR Part 99) restricts disclosure of personally
identifiable information from education records without written consent. A student's
attendance record is an education record. Telling a parent about it is ordinarily not a
disclosure problem, because a parent is the party with rights under FERPA for a minor.

**Where it gets interesting.** The call is placed by software operated by a vendor. That
makes the vendor's status the question, not the parent's. The usual route is the school
official exception at 34 CFR § 99.31(a)(1): an outside party may be treated as a school
official where it performs a service the district would otherwise use its own employees for,
is under the district's direct control as to the use and maintenance of the records, and
does not redisclose.

**What this repository can say.** The work file carries the minimum that a call needs: a
student id, guardian numbers, a locale, a consent flag and an absence date. `student_name`
is present because a call that cannot say the child's name is not a usable call. Nothing else
about the student is read, and the receipt records outcomes rather than record contents.

**Open.** Whether the district's own counsel accepts CALL-E, as the upstream telephony
provider, inside the school official boundary, and what its annual notification of rights
must say. Neither is answerable here.

## 2. May we place an artificial-voice call to a parent's mobile? (TCPA)

**The rule.** The TCPA (47 U.S.C. § 227) restricts calls to wireless numbers using an
artificial or prerecorded voice without prior express consent. On 8 February 2024 the FCC
adopted a Declaratory Ruling recognising that calls made with AI-generated voices are
"artificial" under the TCPA ([FCC news release](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal)).
That ruling is the reason this section exists: it puts a call like this one squarely inside
the statute rather than beside it.

**What this repository does.** `consent` is a required column and a row without it is
`SKIPPED` before any call is placed, which the demonstration shows as `S-1045`. The consent
gate is implemented, tested, and cannot be bypassed by a flag.

**What the parent actually hears, in their own language.** The disclosure is a constant in
`firstbell/domain.py`, not a template, so a deployment cannot reword or omit it. A reviewer
asked the obvious next question: the constant is English, so is a Tamil-speaking parent
disclosed to in English? The answer is on a real call. Work item `S-4106`, `ta-IN`, opens:

> இது பள்ளி வருகைப் பதிவு அலுவலகத்திலிருந்து வரும் தானியங்கி அழைப்பு.
>
> This is an automated call from the school attendance office.
>
> நீங்கள் ஒரு நபருடன் அல்ல, AI உதவியாளருடன் பேசுகிறீர்கள். எந்த நேரத்திலும் பணியாளர் ஒருவருடன் பேச வேண்டும் என்று கேட்டால்,
>
> You are speaking with an AI assistant, not a person. If at any time you ask to speak with a staff member,

That is the first thing said, before anything is asked, and it is the disclosure the FCC
ruling is about. The Tamil is not a translation this project wrote: the locale is one column in
the work file, and CALL-E spoke and transcribed the rest. The English under each
Tamil line is ours, written afterwards from that Tamil and kept in
[`tools/glosses.json`](../tools/glosses.json) so the page and this document cannot
carry two different readings of one sentence. The second line runs on into the next
turn, which is why it stops where it does. The recording is on the [evidence
page](https://firstbell-evidence.vercel.app), which is where every recording lives and not
in this repository, for the reason [`evidence/README.md`](../evidence/README.md) gives. The
English call opens with the same sentence in English. Whether a district's counsel accepts a machine translation of a
disclosure as the disclosure is a question for them, and it is not answered here.

**The gap, stated plainly.** A CSV column reading `yes` is a data structure, not a legal
record of consent. It carries no timestamp, no evidence of what the parent was told, no
record of the channel it was given on, and no revocation path. The software enforces a flag
that a district would have to be able to defend, and nothing here helps it defend one.

**Half closed, and the open half is still the largest one on this page.** The schema half
is done: [`docs/consent-record.md`](consent-record.md) is the shape of a dated consent
record, `dispatch/consent.py` enforces it, and a work file can name one per row in a
`consent_record` column. Eight checks run before a phone rings and every one fails closed:
the record must be in the register, be for this student, not be withdrawn, not have
expired, not be dated in the future, cover `voice` rather than text or email, cover
`attendance` rather than general contact, and name every telephone number on the row.

The eighth is the one your counsel will care about most. Under the TCPA prior express
consent attaches to the number called and not to the person the number belongs to. A row
carries a fallback chain, this software works down it, and a record that names a pupil says
nothing about which of two numbers may be dialled, so a row carrying any number the record
does not name is refused outright rather than refused at the third attempt. A record that
names no number at all still dials, because every register written before that field
existed names none, and the run counts and prints those rows instead of passing them
quietly. `--json` writes one line per call naming the record that authorised it and whether
that record named the number that rang.

A run also prints how many rows it dialled on a record and how many on a boolean, because a
column that says yes is not a record and this page will not let that pass quietly.

What stays open is the conversation, and it is the part that matters to you. Where the
record lives and who may write one. How a parent withdraws, how fast that reaches the
register, and what happens to calls already queued. And whether an unexplained absence is
an emergency: the schema has an `emergency` purpose and this software refuses it, because
deciding that an absence is a safety exception is a decision about a child rather than a
configuration option. Changing that is two constants in `dispatch/consent.py`, and it
should be changed on purpose with a name attached.

## 3. May the call be recorded, and is it? (state wiretap law)

**The rule.** Recording consent is state law and it is not uniform. A majority of US states
permit recording with one party's consent; a minority require all parties to consent.
Placing a call across a state line can engage both states' rules.

**What this repository does.** Recordings of these calls exist, on CALL-E's dashboard and
on this project's evidence page, and they are of calls between the author and the author's
own line made for demonstration. That is said first because the rest of this answer reads
like a stronger claim than it is.

This app never records and has no route to a recording: there is no audio field on any of
the three production responses captured under `tests/data`, and `/recording`, `/audio`,
`/recordings` and `/v1/recordings` all return 404. That is a limitation of the platform
rather than a decision made here, and it happens to be the safer default. What a district
would be relying on, then, is that the software cannot fetch what the platform keeps, which
is not the same as the platform not keeping it.

**Open.** Whether the district's own retention obligations require it to keep a recording it
currently cannot fetch, and what its position is in an all-party state.

## 4. What is kept, for how long, and who deletes it?

**What this repository does.** A run writes one receipt. It carries outcomes, counts,
identifiers and timings. It does not carry a transcript unless `--include-transcript` is
passed, and it never carries an unmasked telephone number: `mask()` is applied on the way out
and `tests/test_privacy.py` fails the build if a number, a key or a seven-digit run reaches a
receipt, a log line or stderr.

**Open.** Retention is undefined here because it belongs to the district's schedule, not to a
tool. A deployment needs a stated life for receipts, a stated life for anything CALL-E holds
upstream, and a deletion path that covers both. This software writes files to a path it is
given and has no opinion about how long they live, which is a gap and not a feature.

## 5. What does the data-processing agreement have to say?

The clauses a district would need, none of which this repository can supply:

- The processor's role, limited to placing attendance calls on documented instruction.
- No redisclosure and no secondary use, which for an AI vendor has to include a written
  position on training.
- Sub-processors named, since CALL-E itself routes through an upstream carrier.
- Where the data is processed, which matters here: the shipped configuration dials Indian
  numbers over an international line from a US caller ID.
- Breach notification, audit rights, and deletion on termination.

## 6. A voice-only service and a guardian who cannot use a voice call

This is the objection that most deserves to be uncomfortable, because the argument for this
software is a language-access argument.

Title VI and the 2015 joint Dear Colleague Letter require a district to communicate with
families in a language they understand. This app answers that by calling in the family's own
language. Section 504 of the Rehabilitation Act and Title II of the ADA require effective
communication with a guardian who is deaf or hard of hearing, and a voice call is not that.
Solving one duty with a channel that cannot serve the other is not a solution, it is a
transfer.

**What this repository does about it now.** The work file carries an optional `voice`
column. `voice=no` means the phone cannot reach this guardian, and it is a gate rather than a
preference: the row is never dialled, it is not counted among the calls that failed, and it
goes to the human queue carrying a reason that says somebody has to reach them another way.
The gate is second, behind consent, because a family that refused to be called is not owed an
outreach on a different channel either. A value in that column nobody recognises raises
instead of guessing, since a spelling mistake there decides whether a person is telephoned.

This closes the record-keeping half of the problem and not the communication half. Before it,
a guardian who could not take the call was dialled, reached nothing, and was filed as a
failure, which on a report reads as nobody answered. The family was reachable. The channel
was not, and the record said the opposite.

The gate is demonstrated rather than described, in the export a district already produces:

    python -m firstbell --work-file examples/absences-oneroster.csv

    [HUMAN] S-2204       this family is not reachable by a voice call; nothing was
                         dialled and somebody has to reach them another way

For a while it was described and not demonstrated, which is a weaker thing than it reads as.
The rule was held by nine tests over CSVs written inside those tests, and no shipped work
file carried the column at all, so a reviewer running everything in this repository never saw
the refusal happen. A district buyer found that by checking all four files.
[`district-ingest.md`](district-ingest.md) has what filling that column costs, because no
student information system carries it and no vendor can populate it for a district.

**What is still not built.** There is no relay support, no TTY path and no SMS fallback.
firstbell does not send the other message; it declines to send the wrong one and hands the
case to a person. There is also still no stated behaviour when a family's language is outside
CALL-E's supported table.

## 7. Who is accountable for the case the software escalates?

A school cannot delegate its duty of care and this software does not ask it to. The rule is
that only an explicit confirmation closes a record, and everything else reaches a person
inside a stated window. `SAFEGUARDING_CALLBACK_MINUTES` is 30.

**Open.** Thirty minutes is a number chosen to be stated rather than a number negotiated with
anybody. A pilot would have to agree it, name the role that owns the queue, and define what
happens to an escalation nobody has picked up when that window expires. Software that
escalates into an unstaffed queue has moved a problem rather than solved it.
