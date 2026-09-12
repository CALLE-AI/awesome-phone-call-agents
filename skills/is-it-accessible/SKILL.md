---
name: is-it-accessible
description: Call a venue and ask the accessibility questions that matter to one specific person — step-free entry, hearing loop, guide dogs, quiet hours, changing places — then return a per-need verdict backed by a direct quote from the call. Use when someone needs to know whether a café, clinic, shop or venue actually works for them before travelling to it, and the website does not say. Returns one structured record per venue with a confidence score, and ranks a shortlist.
license: MIT
---

# Is it accessible?

Whether a place actually works for a disabled person is almost never on its
website. Where accessibility data exists at all it is one flattened claim —
"wheelchair accessible: yes" — that hides the detail deciding the trip: *how
many* steps at the door, whether the accessible toilet is up a flight of
stairs, whether the lift is working today, whether staff will write things down.

So people ring round venues before every outing. That phone work is unpaid,
repetitive, and falls on the person with the least energy to spare. This skill
does the ringing and brings back an answer you can act on.

**What it is not:** an inspection, an audit, or a legal determination. It
records what staff said on the phone. Staff answer in good faith about
buildings they did not design, and they are sometimes wrong. Treat the result
as a much better starting point than a website, not as a guarantee.

## When to use this skill

- Someone is planning a visit and needs to know whether a specific venue works
  for their specific needs.
- Someone has a shortlist of three or four venues and wants them ranked.
- A published accessibility claim needs checking against what staff say.

## When not to use it

- To audit a venue for compliance, or to build a case against one. This asks
  questions; it does not assess anyone against a standard.
- To call a venue repeatedly. One call per venue per enquiry. A business rung
  three times by the same tool is a nuisance, and the answers will not improve.
- To call domestic or personal numbers. This is for businesses and public
  venues.
- Without the person's explicit go-ahead for this specific call.

## Before you start

You need three things.

**A profile.** The needs that matter to this person, each marked `must-have` or
`nice-to-have`. Copy `assets/example-profile.json` and edit it. Run
`node scripts/check_access.mjs --list-needs` to see all 30 need ids and the
question each one asks. Maximum 12 needs per profile — a call that runs past a
dozen questions outlasts the patience of whoever picked up, and the later
answers get terse and unreliable.

**A phone number in E.164 format**, starting with `+` and the country code:
`+15555550123`. Country codes are never inferred from an area code or a place
name. A number without a `+` is rejected, because guessing wrong means calling a
stranger.

**Explicit intent.** Confirm with the person that they want this specific call
placed to this specific venue. A profile on disk is not consent to dial.

For real calls you also need the CALL-E SDK and a key:

```bash
npm install @call-e/calle
export CALLE_API_KEY="…"    # dashboard.heycall-e.com/account/api-keys
```

Dry runs need neither — everything except `--real` runs on Node alone, with no
dependencies installed. Never accept a key pasted into a chat, never print one,
and never write one into a file.

## Safety boundaries

**Dry run is the default.** Every invocation is a dry run against recorded
answers unless `--real` is passed. A dry run opens no socket, spends no credit,
and rings nobody. `IIA_FORCE_DRY_RUN=1` overrides `--real` entirely, so a shared
or demo environment can guarantee nothing dials out however the command is
written.

**Real calls are confirmed twice.** The `--real` flag, then an interactive
prompt showing the venues, the questions and the credit cost. `--yes` skips the
prompt for scripted use — only pass it when the person has already agreed to
this exact call. Without a TTY and without `--yes`, the script refuses rather
than assuming.

**Phone numbers are masked everywhere but the dial.** Output shows
`+1555555****`. Full numbers appear only in the request to CALL-E. Free text
coming back from a call — summaries, notes, quotes — is scrubbed of any run of
eight or more digits before it is printed or stored, because people read numbers
aloud on the phone.

**Nothing about the caller is disclosed.** The call says only that a customer is
planning a visit. Never the person's name, number, condition, or why they are
asking. If the venue asks, that boundary holds.

**The call is a question, never a demand.** No obligation is implied and no law
is cited. If the venue is busy, the call offers to ring back and lets them go.
If they do not know an answer, that is recorded as unknown — a third push gets
a made-up answer, which is worse than none.

**No recurring schedules.** One invocation, one round of calls. If someone wants
repeat checks, create them explicitly and tell the person how to stop them.

**To cancel:** interrupt the process. In dry run nothing has happened. If a real
call is already in flight, interrupting stops the wait but not the call —
CALL-E finishes it. The call id is printed as soon as CALL-E accepts it, before
the wait starts; rebuild the report from it later with
`--call call_… --profile alex.json` rather than starting a new call.

## Workflow

### 1. Establish the need and get explicit intent

Ask what the person needs, in their words. Map it onto need ids from
`--list-needs`. Mark as `must-have` only what genuinely decides whether the
visit can happen — everything else is `nice-to-have`, because a failed
must-have sinks a venue outright.

Confirm the venue and the number with them before going further.

### 2. Write the profile

```json
{
  "id": "alex",
  "label": "Wheelchair user, visiting with a companion",
  "needs": [
    { "id": "step-free-entry", "severity": "must-have" },
    { "id": "accessible-toilet", "severity": "must-have" },
    { "id": "step-free-to-table", "severity": "must-have", "note": "my chair is about 70cm wide" },
    { "id": "accessible-parking", "severity": "nice-to-have" }
  ],
  "language": "English",
  "notes": "Visiting on a weekday afternoon."
}
```

`note` is folded into the question so the venue is asked about the actual chair,
not a generic one. `notes` gives the call context it can use if asked.

### 3. Dry run first — always

```bash
node scripts/check_access.mjs \
  --profile alex.json \
  --venue "Sample Cafe" \
  --phone +15555550123
```

This confirms the profile parses, the number is valid E.164, and the report
renders — with nothing dialled. Do this every time before a real call. Vary
`--fixture` to see how the awkward cases render:
`accessible`, `not-accessible`, `unsure`, `unevidenced-claim`, `hedged-claim`,
`no-structured-result`, `voicemail`, `not-placed`, `not-placed-no-attempt`.

### 4. Place the real call

```bash
CALLE_API_KEY=… node scripts/check_access.mjs \
  --profile alex.json \
  --venue "Sample Cafe" \
  --phone +15555550123 \
  --real
```

Confirm at the prompt. The script prints `Call call_… accepted` the moment
CALL-E takes it, then waits. A call can take an hour or two, and the wait gives
up after ten minutes unless you say otherwise (`--wait 120`); if it does, or if
you stop it, nothing is lost — run

```bash
node scripts/check_access.mjs --call call_… --profile alex.json
```

to rebuild the report from the finished call. One `GET`, no dial, no credit,
no prompt. Pass the profile the call was placed with: the report is built from
the profile you hand it, so a different one shows `unknown` for needs the
venue was never asked.

A single call task carries all recipients, so a shortlist is one batch:

```bash
CALLE_API_KEY=… node scripts/check_access.mjs \
  --profile alex.json \
  --venue "Cafe A" --phone +15555550123 \
  --venue "Cafe B" --phone +15555550142 \
  --real
```

### 5. Read the result honestly

Check the run status and `verdict` before reporting anything. A call that failed,
went to voicemail, or was cut off can still carry a partially filled summary —
`verdict: "unverified"` with an `unverifiedReason` means nothing was
established, and saying otherwise is worse than saying nothing.

**When a call fails, say which side failed.** `callFailure` on the report is
`no-answer` (the phone rang, nobody picked up), `not-placed` (the call never
reached a phone) or `unclassified` (it is not possible to tell). Only the first
is about the venue. Reporting "they did not answer" for a call the provider
never placed tells someone a venue ignored them when a venue was never rung —
and unlike a wrong verdict, nothing later in the conversation corrects it.
Repeat `unverifiedReason` as it stands rather than summarising it into "they
did not respond".

Report each finding with its quote. The quote is the evidence; without it there
is only an assertion. Rank a low-confidence positive *below* a high-confidence
negative — "they said yes but seemed to be guessing" is weaker than "they said
no and were certain".

Always include the not-an-audit caveat when presenting results.

## How the questions are built

This is where the skill earns its place. Asking "are you accessible?" reliably
gets "yes" from a venue with a step at the door — not dishonestly, but because
whoever answered has never had to notice the step.

So every question in the catalogue asks for something countable, locatable or
nameable, and each carries the evidence a complete answer contains:

| Instead of | The catalogue asks |
| --- | --- |
| "Is your entrance accessible?" | "How many steps are there at the main entrance? If there are any, is there a ramp or step-free door somewhere else?" |
| "Do you have an accessible toilet?" | "Is it on the same floor as the main seating area, and is it kept unlocked?" |
| "Are you deaf-friendly?" | "If a customer cannot hear you, are staff willing to write things down or type on a phone?" |
| "Do you have a Changing Places?" | "…with a height-adjustable adult changing bench and a hoist? This is different from a standard accessible toilet." |

A question phrased this way can be answered *wrongly*, which is exactly what
makes the answer worth having. The call is also told to ask one concrete
follow-up when an answer is vague, and to stop after that.

**A counted barrier caps the verdict, whatever the workaround.** "There are
four steps, but we have a ramp" is not a step-free entrance: the steps are
counted and the ramp's gradient and location are not. So the call is told that
a non-zero step count can be `partial` at best, and — in general, because the
same shape turns up on lifts and locked toilets — that "a barrier plus a
workaround is not a clean pass". Both come from real calls that reported a
stepped entrance as `yes`.

This is an instruction to the model, not a rule the report enforces. It is
weaker than the quote rule below, and worth checking rather than trusting: a
`yes` on an essential whose note mentions a barrier deserves suspicion.

## Cost and safety controls

**One credit per venue.** A three-venue comparison spends three. The
confirmation prompt states the count before anything is dialled.

**Retries never dial twice.** Each check sends a stable `Idempotency-Key` that
hashes the profile id, the needs asked, the venue numbers and the UTC day, so
the identical check run again today re-reads the original call rather than
ringing a real business again. Change the needs and CALL-E refuses the reused
key outright; the script says so rather than "try again", because a retry is
the one thing that cannot get past it.

**`--again` is the only way to ring the same venue twice in a day.** It mints
a fresh key. It exists for a venue whose first call went to voicemail or was
never placed, not for asking a venue that has already answered — one call per
venue per enquiry still stands.

**Numbers are validated before anyone is called.** Every number in a batch is
parsed up front. Discovering that venue three is malformed *after* ringing
venues one and two is the worst possible moment to find out.

**Credentials stay in the environment.** `CALLE_API_KEY` is read from the
environment only. It is never a command-line argument (shell history), never
logged, and never written to a report.

## Dry run

The dry run is genuinely offline. It opens no socket, reads no credential, and
transmits nothing — a "dry run" that still sends the venue's phone number
somewhere is not a dry run.

Fixtures deliberately include the cases that break things:

- `unevidenced-claim` — the venue says yes to everything and backs none of it
  up. Must come back as `unknown`, never `suitable`.
- `hedged-claim` — taken from a real call. Every answer *is* quoted, so the
  rule above passes it, but the extraction only claims `medium` confidence and
  the note on the entrance says 77 steps while the verdict says step-free. An
  essential `yes` nobody is sure of must come back as `unknown` too.
- `no-structured-result` — the call connects but yields no structured answers.
- `voicemail` — the phone rings and nobody picks up.
- `not-placed` — the call never reaches a phone at all. Renders as a failure of
  the calling service rather than as a venue that ignored you, and drops
  CALL-E's summary, which on such a call describes a phone that never rang.
- `not-placed-no-attempt` — the voice agent fails before dialling: the task is
  `failed`, the recipient is still `pending`, and there is no attempt and no
  code to classify. Zero attempts is the evidence, and CALL-E's own failure
  message is quoted so the reader can see which side failed.

## Tests

```bash
node scripts/check_access.mjs --list-needs
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture unevidenced-claim
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture hedged-claim
```

The last two must print `UNVERIFIED` with every essential `unknown`. If either
prints `SUITABLE`, the skill is unsafe to use — it would be reporting a claim
nobody can stand behind as a confirmed fact, to someone deciding whether they
can get through the door.

Verify the guards too:

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue X --phone 5555550123          # must refuse: no country code
IIA_FORCE_DRY_RUN=1 node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue X --phone +15555550123 --real --yes   # must stay a dry run
```

## Verifying end to end

Spend one real credit on a number you control — your own mobile — before
calling any business. Answer it, give deliberately vague replies ("yeah, we're
accessible"), and confirm the report records `unknown` rather than `yes`. That
single call verifies the whole chain: goal, schema, quote rule, and rendering.

## Example

```
Sample Cafe  +1555555****
  NOT-SUITABLE

  no       Step-free entrance
           "There are two steps up to the front door, I'm afraid"
  no       Accessible toilet
           "The only accessible one is upstairs and the lift's been out for weeks"
  yes      Accessible parking (optional)
           "Two bays marked out right by the side door"
```

`assets/example-report.json` holds the full JSON shape.

## Known limitations

- **Answers are only as good as whoever picked up.** A new staff member on a
  quiet shift may not know where the accessible toilet is. Confidence scores
  help, but they do not fix this.
- **A venue can be sincerely wrong.** "Step-free" from someone who has never
  pushed a wheelchair through the door is a real risk. The quotes let a reader
  judge for themselves; that is the mitigation, not a solution.
- **No visual verification.** Nobody sees the building. A phone call cannot
  measure a doorway.
- **Language coverage follows CALL-E's supported regions.** Check that the
  destination country and language are supported before relying on a result.
- **Conditions change.** A working lift today says nothing about next Tuesday.
  Re-check before a journey that depends on it.
- **The catalogue is not exhaustive.** 30 needs cover common ground. Anything
  outside it needs a bespoke question, which this skill does not generate.

## References

- `references/safety.md` — consent, the dry-run default, number handling, call
  conduct, and cancellation.
- `references/examples.md` — worked reports for every outcome, including the
  case where a venue says yes to everything and backs none of it up.
- `references/needs-catalogue.md` — all 30 needs, the question each asks, and
  the evidence a complete answer contains.
- `references/calle-integration.md` — API, SDK, CLI and MCP paths, result
  envelopes, and the structured-result contract.
- `scripts/check_access.mjs` — the runnable implementation.
- `scripts/needs.json` — the catalogue as data.
