# DeskHelp

Scheduled phone work for schools, colleges and coaching institutes, with every
answer checked against what the recipient actually said.

Live: <https://deskhelp.onrender.com> · Source:
<https://github.com/vickysharma-prog/DeskHelp.ai> · Demo:
<https://www.youtube.com/watch?v=bN7Rh2KrZKo>

This directory is a catalogue entry. The application lives in the repository
above under MIT, and runs from a clone with nothing installed.

---

## What it did on a real phone

Placed from the product to a handset the author owns, playing the part of a
parent, in the mix of Hindi and English families actually use on the phone.
The parent asked for a discount mid-call:

> **Parent:** कुछ डिस्काउंट मिल सकता है क्या इस महीने मेरे को?
>
> **DeskHelp:** Discount ya concession ke baare mein mujhe yahan koi jaankari
> nahi hai. Yeh cheez office hi confirm kar sakta hai.
>
> **DeskHelp:** Wapas apne sawaal par aate hain — aap sochte hain ki payment
> kab tak ho jayegi?

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

Every week somebody at a coaching institute picks up the phone and works
through the same list. Fees due on Friday. A child missing from the morning
batch. Twenty people who asked about admission in June and were never called
back. It takes most of a week, and the week after that it starts again.

Fourteen workflows ship: fee reminders before and after the due date, absence
checks, repeated-absence checks, admission enquiry follow-ups, requested
callbacks, demo class follow-ups, document chases, parent meeting slots,
end-of-term feedback, next-term re-enrolment, approved announcements, staff
absence, and finding cover for a class.

Each one is a declarative `ActionDefinition`: who is called, what may be said
to them, and what a useful answer looks like. Nothing underneath knows what a
student is, so the same engine runs staff attendance or a vendor confirmation.
The fifteenth workflow is a config object, not a module.

Every workflow ships switched off. Installing DeskHelp is never the same thing
as starting to ring people.

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
call back. This follows the pattern in `roll-call`
([PR #325](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/325)),
cited here as prior art; DeskHelp's absence check is one of fourteen scheduled
workflows rather than a single-morning safeguarding tool.

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

One gate can be left on by accident in a shell profile. Two cannot, because the
second is a list of specific numbers somebody had to enter. Everything else
runs against the fixture transport: the demo, the whole test suite, and a
reviewer's first run all take the path that dials nobody.

The public deployment has live calling off and an empty allow list, so the same
buttons walk the same code and reach no phone. Behind its sign-in sit only
seeded synthetic families in the reserved `NXX-555-01XX` range.

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
attempt whose start and finish are the same instant never rang anybody, so it
is a connection failure rather than a statement about the recipient, and it
reaches a person; the same distinction
[`ringfence`](../../python/ringfence/) documents against the live API.
Anything unrecognised reaches a person, per
[`docs/adr/0006-a-refusal-is-not-a-missed-call.md`](../../../docs/adr/0006-a-refusal-is-not-a-missed-call.md).

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

Node 22.5 or later. The server has no runtime dependencies and Node runs the
TypeScript directly; `npm install` builds the web interface and nothing else.
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
  "unanswered_questions": [{ "quote": "Scholarship milti hai kya?" }],
  "aware_of_due_date": "yes",
  "intends_to_pay_by_date": "no",
  "preferred_channel": "portal",
  "evidence_quotes": { "intends_to_pay_by_date": "nahi ho paayega due date se pehle" }
}
```

CALL-E accepts a narrow slice of JSON Schema: `type`, `properties`, `required`,
`enum`, `items`, `description`, and `additionalProperties: false`. DeskHelp
checks a schema against that vocabulary before sending it, on every path
including fixtures, so a schema mistake surfaces in the test suite rather than
on a live call. The vocabulary is the one
[`kept`](../../python/kept/) documents and enforces.

---

## Example, with fictional contacts

A fee reminder to a guardian in the `NXX-555-01XX` reserved range, rendered by
`npm run live -- --action fee-reminder`, which dials nobody:

```
SAY THIS FIRST, before anything else:
"Hello, this is an automated reminder from the institute about a fee
instalment that is due shortly. This is only a reminder; no payment is
taken on this call."

WHAT YOU MAY SAY IF ASKED — these exact statements and no others:
- fee-due-date: "Doosri kist is mahine ki 15 taarikh tak deni hai."
- office-hours: "Office somvaar se shanivaar, subah 9 se shaam 5 baje tak khula hai."
- payment-channels: "Fees office counter par ya online portal par jama hoti hai."

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

Each account holds one workspace. The scheduler computes the next run for every
workflow and shows it before you arm one; runs are started by an operator.

Language coverage is English, Hindi and the code-switched mix, with Tamil
available through the same register mechanism.

---

## Links

- Application and full documentation:
  <https://github.com/vickysharma-prog/DeskHelp.ai>
- Live demo, which cannot place calls:
  <https://deskhelp.onrender.com>
- Demo video: <https://www.youtube.com/watch?v=bN7Rh2KrZKo>
- Licence: MIT
