# Platform notes

Things worth knowing before building on the phone-call API, collected while
running this skill against real businesses.

**Scope.** Most of what follows was observed on the **MCP/CLI surface** while
running this skill against real businesses, using `@call-e/cli` in the `0.3.x`
line. The REST and Goals surfaces are separate implementations and differ in
ways that are not always documented — see below.

**Re-checked on `@call-e/cli` 0.5.0.** The plan response shape is unchanged:
`structuredContent` still carries `plan_id`, `ready_to_run`, `display_goal`,
`confirm_token` and `confirm_expires_at` under the same names, and the adapter
here parses `0.5.0` responses without modification. Two changes worth knowing
are noted below under *Two timeouts* and *Plans that are not ready*.

**Where a note matters to your correctness, verify it on the surface and
version you are actually using.**

---

## The surfaces are not one API with three doors

Treat them as separate implementations that happen to share a product name. Two
independent integrators and this project disagree about the same behaviours,
which is itself the finding: a guarantee is only meaningful if it names the
surface it was measured on.

Documented differences that have bitten us or others:

- **Transcript shape.** The MCP path returns one newline-joined string with
  `[HH:MM:SS] SPEAKER:` prefixes. The Developer API returns structured turns
  with offsets. LineCanary's `platform-notes.md` records this too. Do not write
  a parser that assumes either without checking.
- **Status vocabulary.** `PREPARING` / `COMPLETED` on MCP; lowercase
  `queued` / `in_progress` / `completed` on the other contract.
- **Real-time transcript streaming.** LineCanary reports incremental ASR
  arriving on the MCP path. `verify-by-phone`'s `api-notes.md` lists real-time
  streaming as a capability *not* to assume. We have seen incremental events on
  the MCP path. **All three can be right on different surfaces or versions**,
  and that is the point.

Practical consequence: if you build against one surface and later add another,
expect to rewrite the response handling, not adapt it.

## The plan response carries more than the docs list

The published return values of the plan call are the plan identifier, a
confirmation token, and a readiness flag. The response also carries the plan's
own version of your task text, under `display_goal`.

That field is not in the documentation we can find, and an undocumented field
can change or disappear without a changelog entry. **Depend on it the way you
would depend on anything undocumented**: read it when it is there, report that
inspection was unavailable when it is not, and never fail a call closed because
a field you were not promised is absent.

Why it is worth reading at all: see `goal-inspection.md`.

## Plans that are not ready

A plan call does not always return something you can run. If the provider needs
more information it answers with `ready_to_run: false`, a **null**
`confirm_token`, and a `clarifying_questions` array — for example, asking which
region a `+1` number should be treated as, since that prefix covers more than
one country.

**Surface those questions.** They are answerable, and a caller who only sees
the plan identifier will discover the problem at run time as a missing token,
which says nothing about what was actually needed.

Do not treat an unready plan as a failure either. Nothing was charged and
nothing was dialled; the provider is asking a question.

## Terminal does not mean retained

The provider is a cache of recent runs, not an archive.

- Runs are removed after a period measured in days.
- **A removed run does not report "gone" — it reports as a failure.** So a
  failure status is ambiguous: the call may have failed, or it may have
  succeeded and then aged out.
- Before removal there is a window in which a run still resolves but comes back
  with an empty payload: correct-looking structure, no summary, no evidence, no
  transcript.

**So local persistence is not an optimisation, it is the only durable record.**
Write the outcome to disk when the run reaches a terminal state, and treat the
provider as unable to answer questions about it afterwards.

Two rules that follow, and both cost one line each:

1. **A hollow read must never overwrite a record that has content.** Append it
   to the existing record as dated evidence instead. Keeping both is the point:
   the content, and the fact that the provider later denied the run.
2. **Mark an empty terminal payload, but do not guess why it is empty.**
   "Aged out" and "nobody said anything" are indistinguishable from the payload.
   A no-answer, a dead-air call and a callee who hung up immediately are all
   real outcomes that look identical here.

## Reading a result

**Check completion before reading anything.** A call that failed, went to
voicemail, or was cut off can still carry a partially filled summary.
`pharmacy-stock-check`'s skill states this well: if the run did not complete
successfully, emit no answer fields at all rather than scraping what is there.

**The summary is prose, and its delimiter is not stable.** Both `key: value` and
`key=value` have been observed, separated variously by commas and semicolons.
Nothing guarantees either. If you ask for named fields, recover them by
splitting on **the key names you asked for**, longest first so that a key which
is a prefix of another cannot claim the longer one's match — never by splitting
on punctuation.

**Summaries commonly append an untagged trailing note.** The last value in the
summary has no following key to stop it, so a naive parse swallows the note into
it. Cut at a sentence break *followed by* a key-shaped token, requiring both, so
that clock times and values containing their own full stops survive. Under-trim
rather than over-trim: the evidence array remains the authority on values.

**The evidence array paraphrases.** It is useful for locating what was said and
poor for quoting it. If you need the callee's words, use the transcript.

**Ignore the provider's confidence score for answer reliability.** It reflects
the model's confidence in its own summary, not whether the callee knew the
answer or told you the truth. Score fields yourself against the transcript.

## Polling

The response carries a suggested poll interval. Use it, clamped to a floor and a
ceiling of your own — several documented cadence values exist and disagree with
each other, and the per-run suggestion is the only one that reflects the actual
call.

Bound the wait. Return control with the run identifier and a resumable command
rather than blocking indefinitely; a call can outlast any reasonable session.

## Two timeouts, not one

If you drive the CLI as a subprocess you have two independent timeouts: the
CLI's own per-request network timeout, and your subprocess ceiling.

**The request timeout must fire strictly first.** If your subprocess ceiling
fires before the CLI's own timeout, the CLI is killed before it can emit its
structured error, and the failure arrives as a bare timeout carrying no detail
about what went wrong. Check the relationship at startup and refuse to run if it
is inverted — the adapter here does exactly that.

⚠️ **The CLI's own defaults are not uniform across commands.** As of `0.4.0`,
planning gets a much longer default than other requests, on the reasoning that
planning legitimately takes longer. If you pass an explicit timeout on every
subcommand — as this adapter does — **you override that, and may be giving the
plan call less time than the CLI would have.** Either pass the flag only where
you need it, or set a value that is generous enough for planning.

## Region and language

Leave the recipient region unset unless you actually know it; the provider
resolves it from the number, and a wrong hint asserts the callee is somewhere
they are not.

**Do not keep a local copy of the supported-region list.** It can only go stale,
and it fails in the worst direction: refusing a call that would have worked.
Validate the format and let the provider reject what it does not support. (Note
`GB`, not `UK`.)

Language is a choice, never an inference. A `+91` number does not imply Hindi.

---

## What none of this tells you

Everything above concerns the API: what comes back, in what shape, and how long
it lasts.

**None of it tells you what the agent actually said on the call.** That is a
separate question, it is not answerable from the response envelope, and it is
the one that decides whether an answer means anything. See `goal-inspection.md`.
