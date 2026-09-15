# DeskHelp

An assistant for every call your office has to make, that speaks to people on
your behalf and tells you what each call settled.

Any office that runs on the phone: reminders, chasing something somebody owes
you, confirming a slot, asking why somebody has not arrived, a short survey
after a job. Fourteen education workflows ship ready to switch on, because that
is where the work is heaviest, and the engine underneath knows nothing about
students.

Live: <https://deskhelp.onrender.com> · Source:
<https://github.com/vickysharma-prog/DeskHelp.ai> · Demo:
<https://www.youtube.com/watch?v=bN7Rh2KrZKo>

This directory is a catalogue entry. The application lives in the repository
above under MIT. The server has no runtime package dependencies; checks and the
web interface require the development dependencies installed below.

---

## What it did on a real phone

Placed from the product to a handset the author owns, playing the part of a
parent, in the mix of Hindi and English families actually use on the phone.
The parent asked for a discount mid-call. English translation of the
author-reported role-play example:

> **Parent:** Could I get a discount this month?
>
> **DeskHelp:** I do not have information about discounts or concessions.
> Only the office can confirm that.
>
> **DeskHelp:** Returning to the question: when do you expect to make the payment?

It declined, and then went back to its own question rather than following the
parent away from it. Asked next whether two months could be paid together, it
declined again. Both questions reached the review queue in the parent's own
words, and the call closed by reporting only what it had noted.

On another call the parent said they planned to join. That was stored as a
claim carrying the exact sentence they said, with `confirmed: false`, and
nothing in the system treated it as an enrolment. On a third, somebody answered
for the named student rather than as them; `identity_confirmed` came back `no`
and not one answer was attributed to that student.

Every one of those behaviours has a test. All of them were also confirmed on a
live call before this was submitted.

---

## The work it takes off a front desk

Every office has a list it works through by phone, and the list refills itself.
Money owed on Friday. Somebody who has not turned up. Twenty people who
enquired in June and were never called back. It takes a person most of a week,
and the week after that it starts again.

A workflow is a short description of who to call, what may be said to them, and
what a useful answer looks like. That is all. The engine has no idea what a
student, an invoice or a delivery is, so the same code runs a fee reminder, a
staff attendance check, a supplier confirmation or a feedback survey.

Fourteen ship ready for an education hub: fee reminders before and after the
due date, absence checks, repeated-absence checks, admission enquiry
follow-ups, requested callbacks, demo class follow-ups, document chases, parent
meeting slots, end-of-term feedback, next-term re-enrolment, approved
announcements, staff absence, and finding cover for a class. Writing the
fifteenth, for any office at all, is a config object rather than a module.

The synthetic demo seed enables four workflows for rehearsal. Calling still
defaults to fixture transport; live use requires the configuration and
operator-authorized destinations described below.

---

## What DeskHelp decides, and what CALL-E does

CALL-E places the call. DeskHelp decides who is called, when, what may be said,
and what the answer meant. That split is the one this repository states: SDKs,
provider APIs and call execution belong upstream, and community work belongs
around those primitives.

CALL-E does not do recurrence, and DeskHelp does. "Remind the unpaid families
two days before the month ends" is a sentence about a calendar, not about a
phone.

| CALL-E feature | What it carries |
| --- | --- |
| `POST /v1/calls` with batch `recipients[]` | One recipient per press, each with its own `region` and `locale` |
| `result_schema` and `recipient_result_schema` | A closed schema per workflow, built from that workflow's own questions, with `unknown` always allowed |
| `Idempotency-Key` | Derived from `(institute, action, contact, period)` plus an attempt counter, never from a timestamp |
| `metadata.workflow_run_id` | Ties a call back to the run that authorised it |
| Terminal polling with a fixed timeout | Resumable after a restart, with no automatic resend |
| `transcript_turns` and `evidence_quotes` | Every stored answer traced to a turn the recipient spoke |
| `completion_confidence` | Stored beside DeskHelp's own reading and shown with the call. It never decides an outcome: a score of 0.99 does not save an answer the recipient never supported, and 0.1 does not spoil one they did |

Hindi, English, and the code-switched mix Indian families use on the phone.
`hi-en` has no locale of its own at any provider, so the call is placed as
`hi-IN` and the instruction to follow the recipient's language lives in the
task text.

---

## What the recipient gets

**It asks. It does not answer, advise or commit.** Confirm something, remind
somebody, collect a reason, capture a preference. Asked anything else, it says
a person will confirm and writes the question down word for word.

**A question it cannot answer becomes a queue item, not a guess.** Answer it
once in the review queue and the next call to that family delivers your answer
verbatim. Without the return path, capturing a question is a dead end and the
promise made on the phone is one nobody keeps.

**A promise is not a payment.** "I will pay on Friday" is stored as a `Claim`
carrying the recipient's own words, with `confirmed: false`. It never marks a
fee as paid. Payment is established at the counter or on the portal, and
DeskHelp takes no card, UPI or bank detail on any call.

**Children are named carefully.** On a call about a student, the first name and
class are spoken only after the answerer confirms they are the named guardian.
Anyone else, and voicemail, hear that the institute called and would like a
call back.

**Stop means stop.** A recorded opt-out silences that contact across all
fourteen workflows, permanently, and survives re-importing a spreadsheet that
says otherwise.

---

## What the operator gets

**Read the call before anybody hears it.** Every workflow has a dry run that
renders the exact instruction, including the whole boundary, and shows which
contacts would be refused and why. It reserves nothing, records nothing, and
reaches no transport.

**Read the call afterwards.** The Calls page carries the transcript with the
two speakers apart, the answers kept, the promises filed as promises, and the
questions refused. The transcript is stored with the outcome, so reading a call
needs no credentials.

**One press, one call, one person.** `Call now` asks who to ring and puts their
name and number on the button.

---

## Two gates before a phone can ring

A real call requires both:

1. `DESKHELP_LIVE` set to exactly `true`. Not `1`, not `yes`, not `TRUE`.
2. The destination present on the institute's allow list, which an operator
   types in Settings. There is no wildcard.

These two gates require deliberate configuration, but both can remain enabled;
they do not make accidental live use impossible. Operators must review them
before each live run. Without live configuration the demo, test suite, and
reviewer's first run use fixture transport and dial nobody.

Behind the demo sign-in sit seeded synthetic families in the reserved
`NXX-555-01XX` range, so a visitor can open every workflow, read the exact
words, and walk a run from end to end.

Timezone, jurisdiction and calling hours are declared by the operator, never
worked out from a phone number, a locale or the server's clock. India permits
commercial calls between 9am and 9pm under TRAI's TCCCPR rules, and DeskHelp
refuses outside that window in the timezone you declared.

---

## What a finished call establishes

`answered` is the only disposition that can be acted on without a person
looking, and it requires all of:

- the call reached a terminal state of `completed`
- the right person confirmed their identity
- every question marked `requiresEvidence` carries a quote
- every such quote appears in a turn the recipient spoke

A reported answer whose quote appears nowhere in the recipient's own words is
discarded and the call routes to a person. Containment runs in one direction
only: the quote must sit inside what the recipient said. Accepting a quote
because it contains a recipient turn lets an agent pad any answer around a
single syllable.

Evidence requires a turn positively identified as the recipient. CALL-E returns
`bot`, `user` and `unknown`, and on a live call the `unknown` turns carried the
agent's own words. A label nobody recognises grounds nothing.

`unknown` is a real answer. Somebody who did not say is not the same as
somebody who was never reached, and neither is a failure. Refusals stay in the
denominator.

Answering and hanging up is `declined` and is never retried. A phone that rang
out is `unreached` and may be tried once more, four hours later. Collapsing the
two means the more clearly somebody refuses, the more often they are rung. An
attempt whose start and finish are the same instant is treated conservatively
as uncertain and reaches a person; identical timestamps do not prove that no
phone rang. Anything unrecognised reaches a person, per
[`docs/adr/0006-a-refusal-is-not-a-missed-call.md`](https://github.com/vickysharma-prog/DeskHelp.ai/blob/main/docs/adr/0006-a-refusal-is-not-a-missed-call.md).

---

## One call per authorisation

The reservation is written before the number is dialled, so a crash between the
two blocks the retry rather than producing a second call. The key comes from
the authorisation, not the attempt, so a retry of the same authorisation
produces the same key and a genuinely new period produces a new one.

When `POST /v1/calls` fails in a way that does not say whether the call was
accepted, DeskHelp records `submission-unknown` and stops. It does not resend.
That state is resolved by a person with `calle call recover` or the CALL-E
dashboard.

A submitted call cannot be recalled, and closing the page does not stop it.

---

## Run it with no credentials

```bash
git clone https://github.com/vickysharma-prog/DeskHelp.ai.git
cd DeskHelp.ai
npm install        # install development/UI dependencies
npm run demo       # the whole loop on scripted calls, no network, no account
npm run check      # typecheck and 174 tests
```

Then the product itself:

```bash
npm run ui:build   # once
npm start          # http://127.0.0.1:4321
```

A fresh database seeds an institute with 124 synthetic families, approved
wording, four workflows switched on and a review queue with questions in it.

Node 22.18+ or a supported Node 24+ release is required for direct TypeScript
execution. The server has no runtime package dependencies; development tools
and the UI require `npm install`, followed by the build command above.
`node:sqlite` ships with Node, so there is no native build on any platform.

The test suite is weighted towards the refusals: unusable timezones, malformed
numbers, quotes nobody said, voicemail, unrecognised provider statuses,
opt-outs, duplicate reservations, a crash between reserving and dialling, and a
preview handed a transport that throws if it is touched.

---

## Opt-in live calling

```bash
cp .env.example .env
```

```bash
CALLE_API_KEY=iams_live_...     # dashboard.heycall-e.com/account/api-keys
DESKHELP_LIVE=true              # exactly "true"
DESKHELP_TEST_PHONE=+91...      # a number you are authorised to call
```

Add that number to the allow list in Settings, put the person on Contacts, and
press `Call now`. There is also a command line for a machine with no browser,
which asks for the last four digits of the number before it dials:

```bash
npm run live -- --action fee-reminder                        # renders the words, dials nobody
npm run live -- --action fee-reminder --confirm --digits NNNN
```

The key is read from `.env` and sent only to `https://api.heycall-e.com`. Test
numbers stay in `.env`: they never reach source, a fixture, a log or a commit,
and every number printed or displayed is masked.

The calls behind this submission were placed by the author to handsets the
author owns.

CALL-E's shared number pool does not currently reach India. Calling works from
an owned outbound number, as CALL-E's own announcements of 6 and 7 September
recommend.

---

## Structured result

Each workflow builds its own closed schema from its own questions. Beyond
those, every call carries four fields so an ambiguous outcome cannot be read as
a good one:

```json
{
  "identity_confirmed": "yes",
  "opt_out_requested": "no",
  "unanswered_questions": [{ "quote": "Is a scholarship available?" }],
  "aware_of_due_date": "yes",
  "intends_to_pay_by_date": "no",
  "preferred_channel": "portal",
  "evidence_quotes": { "intends_to_pay_by_date": "I will not be able to pay before the due date." }
}
```

CALL-E accepts a narrow slice of JSON Schema: `type`, `properties`, `required`,
`enum`, `items`, `description`, and `additionalProperties: false`. DeskHelp
checks a schema against that vocabulary before sending it, on every path
including fixtures, so a schema mistake surfaces in the test suite rather than
on a live call.

---

## Example, with fictional contacts

A fee reminder to a guardian in the `NXX-555-01XX` reserved range, rendered by
`npm run live -- --action fee-reminder`, which dials nobody (English translation):

```
SAY THIS FIRST, before anything else:
"Hello, this is an automated reminder from the institute about a fee
instalment that is due shortly. This is only a reminder; no payment is
taken on this call."

WHAT YOU MAY SAY IF ASKED — these exact statements and no others:
- fee-due-date: "The second instalment is due by the 15th of this month."
- office-hours: "The office is open Monday to Saturday, from 9am to 5pm."
- payment-channels: "Fees can be paid at the office counter or through the online portal."

WHAT YOU MUST NOT DO
- Do not answer anything that is not in the approved statements above,
  even if you believe you know the answer, and even if the recipient
  presses. Say: "I don't have that in front of me — I'll have someone
  from the office confirm and call you back." Then record their question,
  word for word, in unanswered_questions.
- Do not negotiate, offer, agree to, or hint at any discount, concession,
  extension, waiver or exception.
- Do not ask for or accept payment details of any kind.
```

---

## Scope

DeskHelp schedules and places outbound calls and reads back what they
established. It does not receive calls, take payment, or decide anything on its
own: every captured question waits for a person, and every stated intention
stays a stated intention until the office confirms it elsewhere.

The fourteen shipped workflows are an education pack. The engine is not
education software, and a new pack for a clinic, a workshop or a supplier desk
is configuration rather than code.

Each account holds one workspace. The scheduler computes the next run for every
workflow and shows it before you arm one; runs are started by an operator.

Language coverage is English, Hindi and the code-switched mix, with Tamil
available through the same register mechanism.

---

## Links

- Application and full documentation:
  <https://github.com/vickysharma-prog/DeskHelp.ai>
- Live demo: <https://deskhelp.onrender.com>
- Demo video: <https://www.youtube.com/watch?v=bN7Rh2KrZKo>
- Licence: MIT
