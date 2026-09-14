# Safety

## Side effects

Placing a call rings a real person's phone, unannounced, about something they thought was
finished. That is a real intrusion and the reason the bar for proposing one is high.

- One call settles one question. At most one finding per reply.
- No recurring schedule, no automatic retry, no background dialling.
- The only thing written anywhere is a draft handed back to the user. Nothing is sent.
- **A call cannot be recalled.** CALL-E exposes no cancellation operation and a call in
  flight runs to completion. Closing the page does not stop it. Do not imply otherwise.

## Consent and disclosure

- The caller states in its opening sentence that it is an AI assistant and whose behalf it
  is calling on. Disclosure comes before anything is asked.
- The opening says **nothing about the thread**. The subject and the situation are withheld
  until the intended recipient has confirmed who they are, so a stranger who picks up learns
  that an assistant called and not what about.
- It asks one question, reads the answer back, and ends.
- It never agrees, commits, negotiates, or answers on the user's behalf. Any other topic
  is deferred to email.
- On voicemail, an automated system, or the wrong person, it ends politely and leaves no
  details. A message left on a stranger's voicemail is a disclosure the user never
  approved.
- The recipient is someone the user is already corresponding with, who published a number
  to them in that correspondence. This is not cold outreach and must not be used as such.

## Numbers

- A destination comes from the thread the user is looking at, or the user types it.
  **There is no code path that turns a name into a number.** Nothing is looked up,
  inferred, or recalled from a contact store.
- Strict ASCII E.164 only. Validate with `[0-9]`, not `\d` — in Python and JavaScript
  `\d` also matches Unicode digits such as U+0660, so a lookalike number passes a naive
  check and dials somewhere unintended.
- A number without a country code is surfaced as **unusable**, with the reason. It is
  never completed with a guessed country.
- Every destination is masked wherever a human or a log can see it: `+1*******42`.
  Masking is applied recursively to provider-supplied text as well, because summaries,
  transcripts, and error bodies can echo a number back in a shape that was never sent —
  parenthesised, dotted, `00`-prefixed, or bare digits.

## Credentials

- The CALL-E API key lives on the server and is never sent to a browser, an extension, or
  any client. This follows CALL-E's own instruction: *"Do not call the Developer API
  directly from a browser, public frontend, or untrusted client."*
- Credential-bearing traffic is pinned to the official origin. A configurable base URL
  that carries a bearer token is refused at startup, not at call time.
- A deployment that can place real calls refuses to start without its own shared secret.
  An unauthenticated endpoint that dials real phones is an open relay.

## Data handling

- The thread is read in the browser, sent to the user's own server for analysis, and not
  stored. Proposals live in memory and are lost on restart, which is safe; a
  half-remembered call is not.
- Transcripts are shown to the user and not persisted.
- No real transcript, call id, recipient name, or phone number belongs in a repository,
  a fixture, a log, or a demo recording. Fixtures use standards-reserved fictional
  ranges.

## Medical, legal, financial, and emergency boundaries

Do not use this skill where the substance of the answer is medical, legal, financial, or
an emergency — even when the surface form is a scheduling question. "Which day for the
procedure" is a clinical conversation wearing a calendar's clothes.

The caller has no authority to agree to anything. If a recipient tries to settle terms on
the call, the correct behaviour is to decline and defer to email.

## Honest failure modes

These are observed, not hypothetical.

**Confidence is not a success signal.** On four separate calls that never rang, CALL-E
returned `completion_confidence` of 0.85, 0.9, 0.9 and 0.82, all labelled `"high"`, alongside
`task_completed: false`. Confidence describes certainty in the judgement, not the
outcome. Anything that reads it as success will fabricate results.

**No-answer and decline are indistinguishable.** The Calls API's `failure_code` has no
published enum. The informative value appears only at attempt level — an observed
zero-duration `408` meaning the handset was never offered the call — and the task level
reports only `call_failed`. Never infer that a recipient declined.

**Connection is not guaranteed.** Calls to some regions connect intermittently. In
testing against an Indian mobile, roughly one attempt in four connected, with the rest
failing as zero-duration timeouts. A user-facing product must treat a failed call as
ordinary and retryable, not as an error state.

**A reused idempotency key does not place a call.** CALL-E returns the *original* call and
nothing rings. Observed: a retry produced no new record on the platform, no charge, and a
result that was a failure from twenty-five minutes earlier — reported as though it had just
happened.

So the key has to be stable enough that a double-click cannot dial twice, and fresh enough
that a real retry does. An attempt counter alone is not enough if it lives in memory: a
restart resets it, the next request rebuilds a key already spent, and the replay is silent.
Mix a per-process nonce into the key, and treat a returned call that is more than a minute
old as a replay to refuse rather than an outcome to report. The stale *success* is the
dangerous one — it would be drafted into the thread as the call that just happened.

**Task text is followed unevenly, and the differences are reproducible.** Across three live
calls, the same instruction behaved differently depending on how it was written:

| Instruction | As prose | As a numbered step |
| --- | --- | --- |
| Read the answer back before ending | **Dropped entirely** on one call | Followed, with an explicit read-back and confirmation |
| Ask who answered before disclosing | Ignored | Still ignored — see below |
| Greet once only | Ignored | Ignored; the caller opens with two short turns |

Three rules follow, and they apply to any CALL-E task text, not just this one.

*Number the steps.* A paragraph gets reordered and parts of it get dropped. A numbered
sequence with "do not reorder or skip any of them" holds much better.

*Say which step cannot be skipped.* The read-back is the recipient's only chance to correct
a mishearing before it is written down. Stating "do not skip this step, and do not end the
call before they have confirmed" was the difference between it happening and not.

*Some behaviour is the platform's, not yours.* CALL-E discloses that it is an AI in its
opening turn regardless of what the task says. That is the correct norm — asking "is this
Alex?" before saying who is calling is how a cold caller sounds — and instructing otherwise
simply fails. **Design with it rather than against it.** The concern behind our instruction
was still real: the opening was carrying the thread's subject line to whoever picked up. The
fix was not to reorder but to make the opening minimal, so a stranger who answers learns
that an assistant called and nothing about what.

The general point: an instruction that cannot be enforced is not a safety control. If the
behaviour matters, verify it on a real call and design around what the platform actually
does.

**The verbatim quote is the weakest link in the evidence chain.** The gate refuses to
proceed without one, which is right — but its wording inherits speech-recognition quality.
An observed call transcribed a clear spoken answer as *"Up. 2 page summary actually."* The
answer extracted from it was correct; the quotation of it was not clean.

So the quote is shown to the **user**, as evidence that the answer came from a sentence
someone actually spoke, and is deliberately kept **out of the draft reply**. The recipient
knows what they said, and mailing them a garbled transcription of their own words is at
best odd. What belongs in the written record is the agreement, not the phonemes.

**Anything leaving the server is masked, including the user's own thread text.** A finding
quotes the thread verbatim and the thread can carry a number anywhere — a signature, the
sentence itself. Findings, previews, gate reasons and error bodies are all masked on the way
out. Because a client hands a finding back, verification masks the thread before comparing,
so both sides are in the same form; masking is deterministic, so this neither weakens the
check nor lets a paraphrase through.

**The gate checks the quote by matching text, not by understanding it.** The quote must
appear in what the recipient actually said, after case, punctuation and emphasis markup are
normalised away. That catches an invented or paraphrased quote. It does not judge whether
the quote *supports* the answer, and a transcript that is unavailable means the call is
refused rather than trusted.

**Option matching is deliberately narrow.** The answer must contain an offered option as a
whole word, and is rejected outright if it also contains a negation — "not Monday" and
"neither Monday nor Tuesday" used to be accepted as choices. The cost is that shorthand is
refused too: "Mon" does not match "Monday". Refusing is the safe direction, and the user is
told which check failed.

**Detection is rules, and rules miss things.** The detector finds what it is written to
find. It will not catch an ambiguity phrased unusually, and it can raise a finding on a
thread where a human would see no problem. It errs towards silence; the user decides
whether to call.
