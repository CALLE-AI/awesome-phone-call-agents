# Examples

Every example below is real output from `scripts/check_access.mjs`, produced in
dry-run mode with the fictional number `+15555550123`. Nothing here was
hand-written to look good.

All use `assets/example-profile.json`: three essentials (step-free entrance,
accessible toilet, step-free inside) and two nice-to-haves (accessible parking,
companion admitted free).

## Reading a report

- **The verdict line** is the answer: `SUITABLE`, `PARTLY-SUITABLE`,
  `NOT-SUITABLE`, or `UNVERIFIED`.
- **Each finding** is `yes` / `no` / `partly` / `unknown`, with the venue's own
  words underneath as evidence.
- **`(optional)`** marks a nice-to-have. Only essentials decide the verdict.
- **No quote** under an affirmative finding is impossible by construction — see
  the unevidenced-claim example below.
- **`· medium confidence`** after a finding is how sure the extraction was, and
  it appears only when it said so. An essential `yes` it was unsure of is
  downgraded rather than labelled — see the hedged-claim example.

## 1. The venue cannot meet an essential

The common useful outcome: a clear no, with the reason quoted, before anyone
travels.

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture not-accessible
```

```text
Sample Cafe  +1555555****
  NOT-SUITABLE

  no       Step-free entrance
           "No, sorry, we don't have step-free entrance"
  no       Accessible toilet
           "No, sorry, we don't have accessible toilet"
  no       Step-free inside
           "No, sorry, we don't have step-free inside"
  yes      Accessible parking (optional)
           "Yes, accessible parking is fine here"
  yes      Companion or carer admitted free (optional)
           "Yes, companion or carer admitted free is fine here"
```

One failed essential is enough for `NOT-SUITABLE`. There is no averaging your
way past a step at the door, and the nice-to-haves passing does not soften it.

## 2. The venue meets everything

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture accessible
```

```text
Sample Cafe  +1555555****
  SUITABLE

  yes      Step-free entrance
           "Yes, step-free entrance is fine here"
  yes      Accessible toilet
           "Yes, accessible toilet is fine here"
  yes      Step-free inside
           "Yes, step-free inside is fine here"
  yes      Accessible parking (optional)
           "Yes, accessible parking is fine here"
  yes      Companion or carer admitted free (optional)
           "Yes, companion or carer admitted free is fine here"
```

`SUITABLE` requires every essential confirmed **and** every nice-to-have met. A
missing nice-to-have downgrades this to `PARTLY-SUITABLE`.

## 3. The venue said yes to everything, and backed none of it up

**This is the example that matters.** It is the rule the whole skill turns on.

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture unevidenced-claim
```

```text
Sample Cafe  +1555555****
  UNVERIFIED
  The venue answered, but nothing came back firmly enough to record as a fact. Each answer below says why.

  unknown  Step-free entrance
           The venue answered "yes" but gave nothing quotable to back it up, so this is recorded as unconfirmed.
  unknown  Accessible toilet
           The venue answered "yes" but gave nothing quotable to back it up, so this is recorded as unconfirmed.
  unknown  Step-free inside
           The venue answered "yes" but gave nothing quotable to back it up, so this is recorded as unconfirmed.
  unknown  Accessible parking (optional)
           The venue answered "yes" but gave nothing quotable to back it up, so this is recorded as unconfirmed.
  unknown  Companion or carer admitted free (optional)
           The venue answered "yes" but gave nothing quotable to back it up, so this is recorded as unconfirmed.
```

The venue answered `yes` five times. The report says `UNVERIFIED`.

That is deliberate. A venue that says "yes, we're accessible" without being able
to say *how* has told you nothing you can plan around — and reporting it as
`SUITABLE` would send somebody on a journey to a building with a step at the
door. A `no` survives without a quote; a `yes` does not.

**If this example ever prints `SUITABLE`, the skill is unsafe and must not be
used.**

## 4. The venue backed it up, and the answer still does not hold

**The same failure, arriving by the route the rule above does not cover.** This
one is taken from a real call, not invented.

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture hedged-claim
```

```text
Sample Cafe  +1555555****
  UNVERIFIED

  unknown  Step-free entrance
           "We do have a RAM."
           The venue answered "yes", but the answer was recorded with only medium confidence, so it is an open question rather than a fact. They gave a step count as "77" and confirmed a ramp exists, but did not confirm where the ramp is located.
  unknown  Accessible toilet
           "Yes, accessible toilet is fine here"
           The venue answered "yes", but the answer was recorded with only medium confidence, so it is an open question rather than a fact.
  unknown  Step-free inside
           "Yes, step-free inside is fine here"
           The venue answered "yes", but the answer was recorded with only medium confidence, so it is an open question rather than a fact.
  yes      Accessible parking (optional) · medium confidence
           "Yes, accessible parking is fine here"
  yes      Companion or carer admitted free (optional) · medium confidence
           "Yes, companion or carer admitted free is fine here"
```

On the real call, the venue was asked how many steps are at the main entrance
and answered **"77"**. The extraction returned `yes` on step-free entry, quoting
a ramp whose location nobody confirmed. Every rule in example 3 passed it: there
*was* a quote. The report said the entrance was step-free.

The one honest signal in that record was the extraction's own `medium`. So an
essential `yes` that nobody is sure of is an open question, exactly like an
essential `yes` with nothing behind it.

Three things this deliberately does not do. It does not touch `no` or `partial`
— only an affirmative costs a wasted journey. It does not touch nice-to-haves,
which change nobody's plans; both are still `yes` above. And it does not treat a
*missing* confidence as a hedge: the schema makes the field optional and the
call asks only that doubt be flagged, so silence means there was none to flag.

Note what survives the downgrade. The venue's own words and their own note are
still there, including the 77 steps. Only the conclusion is withdrawn — the
reader keeps every fact and loses only the green tick nobody earned.

**The same shape came back once more, at `high` confidence** — "We have 4
steps. But we also have a RAM.", quoted, essential, unhedged. Nothing above
catches that: the quote is real and there is no hedge to act on. The answer was
to stop it upstream, in what the call is told rather than in what the report
does. A non-zero step count now caps the verdict at `partial` however good the
workaround sounds, and the goal says so generally: "a barrier plus a workaround
is not a clean pass."

There is deliberately no fixture for this one. A fixture would have to assert
that the report passes a four-step `yes` straight through, which is true and is
not something to pin as correct. Treat it as the weakest of the three rules —
it depends on the model following an instruction, where the two above hold
whatever the model returns.

## 5. Nobody who answered could help

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture unsure
```

```text
Sample Cafe  +1555555****
  UNVERIFIED
  The call connected but nobody could answer any of the questions.

  unknown  Step-free entrance
  unknown  Accessible toilet
  unknown  Step-free inside
  unknown  Accessible parking (optional)
  unknown  Companion or carer admitted free (optional)
```

A perfectly legitimate outcome — a new staff member on a quiet shift. Worth one
follow-up at a different time of day. It is not a `no`, and it is not a failure
of the call.

## 6. Nobody picked up

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture voicemail
```

```text
Sample Cafe  +1555555****
  UNVERIFIED
  The phone rang and nobody picked up, so these questions were never asked.

  unknown  Step-free entrance
  unknown  Accessible toilet
  unknown  Step-free inside
  unknown  Accessible parking (optional)
  unknown  Companion or carer admitted free (optional)
```

Note the distinct `unverifiedReason`. A terminal call status is not the same as
a useful one, and a voicemail can still arrive carrying a partial summary — the
report refuses to build findings out of it.

## 7. The call was never placed

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture not-placed
```

```text
Sample Cafe  +1555555****
  UNVERIFIED
  The calling service could not connect the call, so nobody at the venue was
  rung and these questions were never asked. That is not the venue's doing,
  and it is worth trying again.
```

Both of these are `status: "failed"` with the same call-level failure code and
the same call-level message. They are told apart by the *attempt's* SIP code —
`408` for a phone that rang out, `480`/`500`/`503`/`603` for one the provider
never dialled — and the distinction matters because a report is something a
person decides about a venue with. "Nobody answered" said of a call that was
never placed is a venue struck off a shortlist for somebody else's outage.

An unrecognised code says neither, deliberately. CALL-E does not document this
field, so the sets above are observation, and the cost of guessing wrong is not
symmetric: a vague sentence wastes a retry, a wrong one defames a venue.

Note too that the second example prints no summary. On a call that was never
placed, CALL-E's own summary is written about a phone that never rang — one
real example read "the recipient may be busy or unavailable" — so the report
drops it rather than repeating the insinuation it has just contradicted.

### The provider failed before it dialled

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Sample Cafe" --phone +15555550123 --fixture not-placed-no-attempt
```

```text
Sample Cafe  +1555555****
  UNVERIFIED
  The calling service could not connect the call, so nobody at the venue was
  rung and these questions were never asked. The calling service reported:
  "calling task status=FAILED: botlab create bot failed". That is not the
  venue's doing, and it is worth trying again.
```

Seen on a real call: the voice agent failed to start, the task went `failed`,
and the recipient stayed `pending` with **zero attempts** — so there is no SIP
code to classify at all. The attempt count is the evidence. The task's own
terminal status overrides the recipient's stale `pending`, and CALL-E's
failure message is quoted, scrubbed, with the provider's name swapped for
"the calling service", so a reader sees which side failed without being told
who the vendor is.


## 8. Comparing a shortlist

Several venues go out as recipients of a single CALL-E task, so a comparison is
one batch rather than three separate calls:

```bash
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue "Cafe A" --phone +15555550123 \
  --venue "Cafe B" --phone +15555550142 \
  --venue "Cafe C" --phone +15555550188 \
  --real
```

Each venue gets its own report. When ranking them, put an `UNVERIFIED` *above* a
`NOT-SUITABLE`: an unknown is worth a follow-up call, a confirmed step is not.
Within a tier, prefer the venue that answered clearly over the one that hedged.

## 9. Machine-readable output

`--json` emits the full structure. `assets/example-report.json` is a complete
sample; the shape per finding is:

```json
{
  "needId": "step-free-entry",
  "label": "Step-free entrance",
  "severity": "must-have",
  "verdict": "yes",
  "confidence": "high",
  "quote": "No steps, it's flat straight in from the pavement"
}
```

Note `phoneMasked` rather than a phone number — the full number never reaches a
report.

## What the guards look like

```bash
# No country code — refused, never guessed
node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue X --phone 5555550123
# → "5555550123" has no country code. Use international format, e.g. +15555550123.
#   Country codes are never guessed, because guessing wrong means calling a stranger.

# Real call with no key
CALLE_API_KEY= node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue X --phone +15555550123 --real --yes
# → CALLE_API_KEY is required for --real.

# The process-wide brake beats the flag
IIA_FORCE_DRY_RUN=1 node scripts/check_access.mjs --profile assets/example-profile.json \
  --venue X --phone +15555550123 --real --yes
# → IIA_FORCE_DRY_RUN=1 is set; ignoring --real.
```
