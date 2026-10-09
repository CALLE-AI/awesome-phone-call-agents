# Sparbird

Get rejected before the real call.

Pick the sort of person you have to win over: the investor who interrupts anything vague, the
seller whose listing just died, the hiring manager reading a CV that sounds a little too good.
Sparbird rings your own phone and plays them. They push back the way they will on the day, and
when you hang up, every line you said is marked against what that person actually needed to hear,
quoted back with the second it happened.

The point is not that a machine rang you. The point is that you find out which sentence lost them
while it still costs you nothing.

Most phone-call workflows place a call to get something done: confirm the order, chase the
invoice, check on the patient. This one places a call so that a person gets better at making them.
The call is the thing under examination, not the tool, and the person being rung is the person
who asked for it.

**Contribution area: User-facing Apps.** This directory is a catalogue and setup guide for the
runnable [Sparbird application](https://github.com/Shiven-Singh/sparbird), maintained there under
the MIT licence. These instructions describe revision
[`8cdd96b`](https://github.com/Shiven-Singh/sparbird/tree/8cdd96bbef7834c3ef9e3cbadea9d95d1ac3db27).

- [Source repository](https://github.com/Shiven-Singh/sparbird)
- [Safety notes](https://github.com/Shiven-Singh/sparbird/blob/main/SAFETY.md)
- [CALL-E adapter](https://github.com/Shiven-Singh/sparbird/blob/main/src/lib/calle.ts)

## Who it rings

Itself, in effect. Sparbird dials the phone belonging to the person using it, and there is nowhere
in the application to type anybody else's number into a call. There is no contact list, no CSV of
recipients, and no multi-recipient code path: the CALL-E request is built with `recipient` in the
singular because there is no second place for a number to go.

That is the whole reason it needs no consent flow. The person consenting, the person dialling and
the person answering are the same person.

Where `OWNER_E164` is set, the entire installation is pinned to that one phone and nothing a user
types can override it. Only an account carrying that same number may make it ring, so a publicly
reachable deployment cannot be used to dial its owner. Everyone else is given a recorded call
instead, scored identically, and the page says so rather than pretending the button is broken.

## What happens on one call

1. You choose a caller and, if you like, how they should come at you today: their mood, and what
   they walked in wanting. The same person, a different day.
2. You press the button, and are shown the masked number about to ring before anything is dialled.
   Nothing happens until you confirm.
3. Sparbird compiles the persona into one task and sends a single `POST /v1/calls`. No schedule,
   no queue, no retry that could become a second call: the idempotency key is derived from the
   persona, the settings and the minute.
4. The caller waits until you have spoken before it says anything at all. You are answering a
   ringing phone and will say hello; a disclosure delivered to a ringing handset has been heard by
   nobody.
5. It then says, word for word, that it is a simulated practice persona and not a real person.
   That line is written by the compiler and cannot be edited or removed by a persona file.
6. It plays the character for the rest of the call, pushing back on what you actually said rather
   than reading from a script, and hangs up when you do.
7. The transcript is scored, stored, and shown to you with the evidence attached.

## How it marks you, and when it refuses to

Two layers, and the second is not permitted to flatter you.

The first is arithmetic on the call's own timestamps: how much of it you talked, how long before
you said a real number, whether you returned to your point after being cut off.

The second is the rubric. An item scores only when a line of the transcript proves it, quoted word
for word. Where nothing proves it, the card says the call did not show it rather than saying you
failed. That is why a result reads "3 of 4 things landed" and never as a bare percentage.

Then it names one thing. A card that lists five observations is a report, and nobody improves
from a report; they improve from one sentence they can say out loud. Sparbird picks the unmet
item that cost the most and gives you its line, written by whoever wrote the persona rather than
generated at the moment of use. The evidence is deterministic and the advice is somebody's, which
is the same bargain the rest of the marking makes.

Every call also gets a plain-words review in three parts: what worked, what hurt, and what to watch.
The third is the one a sales manager would care about. It picks out a promise you made on the line,
an absolute you cannot back, a forecast with nothing behind it, pressure, or running down a
competitor, and it quotes your exact words with the time they were said. A flag that cannot quote
the transcript is discarded rather than shown.

There is a third behaviour worth knowing about. CALL-E returns its own structured account of how
the call went, and occasionally that account does not match the recording. Where the two disagree,
Sparbird keeps the recording, says on the page that it has done so, and marks from what was
actually said.

That is this repository's own [rehearse before you act](../../../docs/rehearse-before-you-act.md)
pattern pointed at a person rather than at an automation. A structured result is a report to be
checked against the transcript turn it came from, not a fact to mark somebody on, and the
disclosure is verified from the transcript rather than assumed because the task asked for it.

## What it is measured against

Five personas carrying twenty rubric items worth fifty-one points between them, and eleven
scripted objections. Seven recorded calls, seventy-eight transcript turns, every one of them a
call that is meant to come out a particular way.

`pnpm e2e:dry` replays all seven through the real compiler, the real scoring engine and the real
judge, and asserts what each must produce. The expectations are written down rather than inferred,
so a change that quietly makes marking more generous fails the run:

| Recorded call | Must produce |
| --- | --- |
| `investor-strong` | at least 8 points, and a `promise` flag for a commitment made on the line |
| `investor-weak` | no more than 2 points, and an `unbacked_claim` flag |
| `investor-contradiction` | the platform result disputed and set aside |
| `expired-strong` | at least 8 points, and an `overclaim` flag for a guarantee that was not theirs to give |
| `difficult-clean` | at least 8 points and no flags at all |
| `cfo-partial` | between 5 and 8: held the price, found the decider, never costed the status quo |
| `hiring-weak` | no more than 2 points |

The run also checks that every flag quotes words that genuinely appear in the transcript, that the
compiled task carries the disclosure, and that a preview never prints a destination number in
full. A flag that cannot quote the call is a failure of the test, not a finding.

`investor-contradiction` is the one worth reading. CALL-E reports `next_step_agreed: "yes"` and
`quantified_ask: "yes"`; the transcript contains neither. The run asserts that both are caught:

```text
[disputed] next_step_agreed claimed "yes": The persona refused on the call.
           No turn contains an agreement to a next step.
[disputed] rubric_observations.quantified_ask claimed "yes": No trainee turn in
           the transcript contains a figure of any kind.
```

No key is read and no network is touched for any of this.

## What happened when it rang a real phone

The recorded corpus is not the evidence that matters most. Calls placed against the live CALL-E
API to an Indian mobile found two defects that no amount of replaying fixtures would have
surfaced.

**The disclosure was being delivered to a ringing handset.** The first call that connected put the
line out at zero seconds; the trainee picked up at nine. The transcript is unambiguous about it:

```text
[  0s] THEM: Heads up,
[  0s] THEM: this is a simulated practice persona, not a real person.
[  9s] YOU : Hello. Hello.
[ 10s] THEM: I'm The First-Principles Investor;
[ 11s] THEM: pitch me only if you can quantify the ask now.
[ 19s] THEM: Can you hear me?
```

The one line that cannot be edited or removed had been spoken to nobody, and the character was two
turns in before a person was listening. The caller now says nothing at all until the other person
speaks, then discloses, then becomes the character. A disclosure nobody hears is not a disclosure,
and only a real call could have shown that.

**The routing hint was following the persona rather than the destination.** Calls carried
`region: "US"` because that is what the persona file said, whilst dialling `+91`. The region now
follows the number being rung; the locale does not, because an American investor should still
sound American when he rings you in Chennai. Those are two different questions that had been
sharing one field.

Both are fixed. The failure codes CALL-E returns are surfaced verbatim with the advice that
applies, rather than collapsed into one unhelpful sentence, because the first version of this made
`unsupported_region`, `insufficient_balance` and a bad key all read identically.

## Known limitations

- Audio quality on an international line is poor. CALL-E's own documentation describes its
  international pool as primarily intended for testing, and it sounds like it. Calls to a
  destination with a local line fare better.
- CALL-E does not return call audio, so playback replays the transcript against its own
  timestamps rather than pretending to be a recording. The player is written for audio and will
  use it the day the API returns any.
- The default judge is deterministic pattern matching over the transcript, not comprehension. It
  is honest about what it cannot check and says so on the card rather than guessing. A model judge
  is opt-in and off by default.
- Five archetype personas ship with it. Building one from a profile is implemented but is only as
  good as what the person has written publicly about themselves.
- Where the filesystem will not survive a restart, history is held in memory and lost with the
  process. That is the right default for a demo and the wrong one for a product.

## Side effects

- One outbound phone call to the number described above, and only when live calling has been
  switched on and the confirmation accepted.
- CALL-E bills for calls it places. Charges accrue on the account whose key is configured.
- Results are written to a local SQLite file, or held in memory where the disk will not survive.
- Nothing is scheduled and nothing recurs. There is no background worker and no job queue, so
  there is nothing to cancel: a call happens when a person presses a button, and ends when they
  hang up.

## Running it without any phone ringing

This is the default. No key is read, no network is touched, and no call is placed.

```bash
git clone https://github.com/Shiven-Singh/sparbird.git
cd sparbird
pnpm install
cp .env.example .env
pnpm e2e:dry
```

`pnpm e2e:dry` replays seven recorded calls through the real persona compiler, the real scoring
engine and the real judge, then asserts the things that have to stay true: a good pitch scores, a
poor one does not, and a platform result that contradicts its own transcript is caught and set
aside. It also checks that the compiled task carries the disclosure and that a preview never leaks
a full destination number.

`pnpm dev` then serves the application at `http://localhost:3000`, where every caller replays a
recording and says so on the page.

## Switching live calling on

Three things have to be true, and the application will tell you which one is missing rather than
failing at the moment you press the button:

```bash
pnpm preflight
```

| | |
| --- | --- |
| `CALLE_API_KEY` | a developer key from the CALL-E dashboard |
| a phone number | saved on your account, or `OWNER_E164` to pin the whole installation to one |
| `SPARBIRD_LIVE=1` | exactly `1`. Anything else, including empty, replays recordings |

Then take a call from the application, or from a terminal:

```bash
pnpm drill first-principles-investor
```

It prints who is calling, shows the destination masked, and dials nothing until you type `yes`.

## What it will not do

It will not call anybody but you. The destination is the number on your own account, or
`OWNER_E164` where that is set, and a drill that somehow resolves to a different one throws before
the CALL-E client is constructed.

It will not pretend to be a real person, and it will not claim to be any specific named individual.
If asked outright whether it is an AI, it says yes.

It will not mark a call that did not happen properly. Where the line drops, or the service returns
something it cannot support, you are told that, rather than given a poor score for it.

It will not run anything in the background. No schedule, no queue, no surprise calls.

Numbers are validated as E.164 and never printed in full; anything phone-shaped in a transcript is
masked before it is stored. Samples throughout use standards-reserved fictional numbers.

## Built with

TypeScript, Next.js and Tailwind, on Node. Storage is SQLite, or memory where the disk will not
survive a restart. The scoring engine is plain TypeScript with no model call in the default path,
which is why the same code runs from a terminal with no server at all.
