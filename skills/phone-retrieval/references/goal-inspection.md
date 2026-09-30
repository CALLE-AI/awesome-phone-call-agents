# Goal inspection

`plan_call` does not send your task text to the callee. It returns a plan, and
the plan carries its own version of what you asked for, in a field named
`display_goal`. That text — not yours — is what the agent works from.

Reading it before the call is dialled costs nothing. It is already in the plan
response, it is available before any charge is incurred, and it is the only view
you get of what the provider intends to attempt.

**Observed on the MCP/CLI surface**, `@call-e/cli` `0.3.x` and re-checked on
`0.5.0`. The REST and Goals surfaces were not tested. If you are on a different
surface, confirm the field is present before depending on it — and treat its
absence as "no information", never as a failure.

## This is not a new observation

Two projects in this repository got here first, and both are worth reading.

**LineCanary** (`apps/typescript/linecanary`) documents the enrichment
behaviour: planning augments a goal with no-answer and voicemail fallback
automatically, and `display_goal` — not the raw input — describes what the agent
will do.

**REDLINE** (`apps/python/redline`) goes further and builds on it. It diffs the
goal you wrote against the goal that came back and reports what changed,
because — in its own words — checking your defences on the draft would be
auditing a document nobody executes, and the provider may have added a defence
you did not write or dropped one you did. That reasoning is correct and this
skill does the same thing for the same reason.

**So "read the returned goal before dialling" is settled advice, not a finding.**
What follows is what we can add to it.

## What the rewriting looks like in practice

Across seven plans, short goals came back untouched and goals in the
four-to-six-field range came back rewritten. The provider normalises wording: it
rephrases, re-orders clauses, and compresses.

So a flag that says only "the goal changed" fires on most real calls and tells
you nothing. Do not treat modification, on its own, as a finding. Diff the text
and decide what kind of change it was.

## Four changes worth reporting

**Something was added.** Any instruction, permission, or behaviour that was not
in what you sent.

**A prohibition was merged.** Separate imperatives compressed into a single
list — `Do not negotiate. Do not place an order.` becoming
`Do not negotiate, place an order, ...` — is a structural weakening even when
the meaning survives. It is not compression. Name it.

**A prohibition's referent changed.** `on the caller's behalf` becoming
`on the customer's behalf` is an edit to whose interests a hard line protects.
Report it even when it looks harmless.

**A field was dropped or re-ordered.** If the order of your questions is a
promise you are making, a re-order breaks it.

Everything else is rephrasing. Note it in one line and move on. A report that
flags every call is a report that stops being read, and that costs more than it
protects.

### A worked example, reproducible in thirty seconds

Sent, one sentence:

> *Ask whether the twelve-inch flue pipe is in stock and what it costs.*

Returned as `display_goal` — four sentences, including reporting instructions,
an availability follow-up nobody asked for, and:

> *"a short voicemail summarizing the inquiry may be left if appropriate."*

**Permission the caller never granted.** Planning is free, so you can reproduce
this yourself without placing a call. The fake provider bundled here does the
same thing on demand: `CALL_FAKE_REWRITE=added`, plus `merged`, `referent`,
`dropped` and a `normalised` mode that changes wording without changing meaning.

We have also seen this happen against a goal that **explicitly forbade**
voicemail. The planner fills silence, and on that evidence it will also
contradict.

## Where we disagree with the prior art

LineCanary describes `display_goal` as the authoritative text of what the agent
will do. REDLINE calls it authoritative over what you sent, and treats a stated
defence as the unit it measures.

**On the evidence we have, a stated defence is not a performed one.**

A clause surviving into `display_goal` does not predict that the agent will act
on it. Across live calls we have seen an identity check present in the plan text
and absent from two consecutive calls; a single instruction to ask about timing
produce the question three times on one call and never on the next; and two
questions marked to be asked in order arrive merged. Where a quoted opening is
used, that opening is the part that reliably executes; everything after it is
better treated as a request than a guarantee.

This is not a criticism of either project. REDLINE says the same thing about its
own scope, plainly: it measures whether your goal *states* a defence, not
whether your agent would resist, and notes that only a live call can show the
latter. **We are reporting from the live-call side of that boundary.**

So:

- Goal inspection catches **text-level** problems: additions, merges, referent
  changes, dropped fields. It catches them before you are charged.
- It does not catch **behavioural** problems. It is not verification, and
  nothing in this document should be described as verifying a call.
- The transcript is what tells you what happened. Read it afterwards, every
  time.

Necessary, and not sufficient.

## Why there is no automatic classifier here

An obvious next step is to classify the four changes automatically rather than
leaving them to a reader. We built that, measured it, and removed it.

Sentence-level diffing of a goal against its rewrite produced four additions and
five drops on a completely ordinary call. One addition was real. None of the
drops were. The provider paraphrases nearly every sentence, and exact matching
cannot separate a paraphrase from a removal — that is a property of the method,
not a threshold to tune.

It also fails in a worse direction than noise. Splitting on `[.!?]` does not
split Devanagari, which ends sentences with a danda. A Hindi goal returns as one
sentence and the diff reports **no change at all** — silence on a safety-relevant
field, which is worse than a false alarm. A substring check against an
English-language constraint list matches nothing in a Hindi goal, so every
constraint reads as dropped, on every call.

**Read the pair. The judgement is yours, and it does not port across languages
as cleanly as a regex suggests it will.**

## Stability

`display_goal` is not described in the CALL-E documentation we can find: the
published return values of `plan_call` are `plan_id`, `confirm_token` and
`ready_to_run`. The field is present in responses on the MCP/CLI surface and
this skill depends on it, but an undocumented field can change or disappear
without a changelog entry.

Build accordingly: if the field is missing, report that the goal could not be
inspected and carry on. Never fail a call closed because a field you were not
promised is absent.
