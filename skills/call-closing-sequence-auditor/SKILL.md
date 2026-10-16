---
name: call-closing-sequence-auditor
description: Offline heuristic CALL-E transcript skill that audits the call's closing window for conversation-analytic completeness - pre-closing summary, arrangement for next steps, completed terminal exchange, dangling callee questions, business after the farewell, abrupt ends - and emits a clean-closing goal template. It is not a satisfaction measure, proof the call failed, or authorization to act automatically.
license: MIT
---

# call-closing-sequence-auditor

> **The last twenty seconds are what the person repeats to their
> family. The body of the call is forgotten; the ending is the memory.**

Closings are not hanging up. In conversation analysis they are an
organized sequence the two parties co-produce: a pre-closing summary of
what was settled, an arrangement for what happens next, a mutually
exchanged goodbye. A call that stops short of that sequence leaves the
person with unanswered questions, or with business introduced after the
farewell that nobody can act on. This skill grades the shape of that
final sequence on a finished CALL-E transcript.

## When To Use

- after any outcome-bearing CALL-E call, before writing up the results
- in QA pipelines, to batch-scan finished transcripts for endings that
  need a follow-up touch
- before replaying calls with a tighter scripted closing, to compare
  ending shape across runs

## When Not To Use

- as a satisfaction or call-quality score; the card measures sequence
  shape, not how the person felt
- when the callee hung up mid-flow; truncation by the caller is a
  legitimate ending and is not the agent's failure
- during a call; strictly post-call analysis plus pre-call goal crafting
- on non-English transcripts; every lexicon is English-only

## Workflow

### Audit a finished call

```bash
python3 scripts/closing_sequence_auditor.py analyze \
  --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skill fixtures. The closing
window is the last 6 turns (the whole transcript if shorter); the six
checks are:

- `summary_present`: an agent turn in the window that marks a summary
  ("just to confirm", "to recap", ...) or states a confirm verb
  ("booked", "confirmed", ...) backed by a concrete value
- `arrangement_present`: an agent move that settles the next step
  ("we'll send", "you'll receive", "no further action", ...)
- `terminal_exchange_complete`: the agent said a farewell in the window
  and the callee said one anywhere after the first turn
- `dangling_question`: the callee's last "?" received only farewells -
  or nothing at all
- `post_closing_business`: the agent introduced values or questions
  after its own first farewell
- `abrupt_end`: no agent farewell in the window and the call stops on a
  question or a plain non-farewell turn

- `verdict`: `WELL_FORMED_CLOSING` / `DEFICIENT_CLOSING`, plus `unclear`
  paths (empty transcript, insufficient signal); `reasons[]` lists the
  gaps in a fixed order - `MISSING_SUMMARY`, `MISSING_ARRANGEMENT`,
  `NO_TERMINAL_EXCHANGE`, `DANGLING_QUESTION`, `POST_CLOSING_BUSINESS`,
  `ABRUPT_END` - with `NO_TERMINAL_EXCHANGE` suppressed when
  `ABRUPT_END` already names the truncated goodbye

### Craft the clean-closing goal

```bash
python3 scripts/closing_sequence_auditor.py craft --scenario clean-closing
```

Emits the plan_call inputs JSON whose goal sequences a clean ending:
restate the outcome with its key value, state the next step, ask for
further business and wait, only then say goodbye.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Opening up Closings (Schegloff & Sacks, Semiotica 7(4):289-327, 1973) | Foundational conversation analysis of how closings are co-produced: possible pre-closings, arrangement sequences, terminal exchanges - our six checks operationalize the sequence shape |
| Towards Objectively Benchmarking Social Intelligence of Language Agents at the Action Level (Wang, Dai, Liu, Wang et al., Findings of ACL 2024, arXiv 2404.05337) | The STSS benchmark treats "when to end a conversation" as a socially-sensitive agent action that can be scored objectively - closing behavior is measurable, not just vibes |

Citation notes recorded during verification: both references were
web-verified on 2026-10-01 with the exact venues and IDs shown above.
This skill compares lexical sequence shape only, has no access to
prosody or intent, and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-goal-drift-auditor` audits topic discipline across the whole
  call against the goal; this skill audits only the final sequence's
  shape.
- `call-review` checks result-field support and compliance; the
  farewell structure is outside its checks.
- `call-agent-commitment-tracker` tracks obligation payloads wherever
  they occur; this skill checks only that the closing contained an
  arrangement MOVE.
