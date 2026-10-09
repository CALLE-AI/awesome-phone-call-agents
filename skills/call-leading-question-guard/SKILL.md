---
name: call-leading-question-guard
description: Offline heuristic CALL-E phone call transcript skill that classifies agent questions into leading forms (tag questions, negative interrogatives, presupposition triggers, coercive framing), flags values affirmed under leading forms as tainted elicitation, and emits a neutral-elicitation goal template. It is not proof an answer was coerced, intent detection, or authorization to act automatically.
license: MIT
---

# call-leading-question-guard

> **A leading question does not ask - it instructs the answer, then
> collects a signature.**

How a question is worded shapes what comes back. "What day works best
for you?" and "You can pick up on Friday, right?" are both questions,
but only one hands the person a decision; the other hands them a form
to sign. On a phone call, where answers are spoken and immediately
acted on, that wording pressure can end up driving bookings and record
updates. This skill grades the agent's interrogation wording, not the
callee's answers.

## When To Use

- after any CALL-E call where the agent elicits decisions (dates,
  times, amounts, plan choices) from the person
- when a recorded value was affirmed immediately after an agent
  question and you want to know how the question was framed
- before placing calls, to craft a neutral-elicitation goal that opens
  open-form and confirms in bounded closed form
- as a review aid alongside sibling conduct skills on the same
  transcript

## When Not To Use

- on the callee's questions - only agent turns are scanned
- to prove coercion; a flagged form is not proof the answer was
  coerced, and a confident person may genuinely agree - the card
  routes to review, always
- during a call; strictly post-call analysis plus pre-call goal
  crafting
- non-English transcripts; the form families are English lexical
  patterns

## Workflow

### Audit a finished call

```bash
python3 scripts/leading_question_guard.py analyze \
  --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skill fixtures; no goal file
is needed. Emits a card:

- `questions[]`: every agent question sentence, classified as `TAG` /
  `NEGATIVE_INTERROGATIVE` / `PRESUPPOSITION` / `COERCIVE` (leading)
  or `OPEN` / `CLOSED` (neutral)
- `tainted_elicitation[]`: values the callee affirmed (affirmation
  word plus a weekday, ordinal date, amount, or clock time in the same
  turn) within two turns of a leading question - candidates for
  neutral re-confirmation, never auto-invalidations
- `verdict`: `NEUTRAL_ELICITATION` / `LEADING_QUESTIONS_DETECTED` /
  `LEADING_TAINTED` / `NO_QUESTIONS_ASKED`, plus `unclear` paths
  (empty transcript, no agent turns)

### Craft the neutral goal

```bash
python3 scripts/leading_question_guard.py craft --scenario neutral-elicitation
```

Emits the plan_call inputs JSON whose goal opens with an open question,
lets the person answer in their own words, confirms in bounded closed
form, and never re-asks a declined question in leading form.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Reconstruction of automobile destruction: An example of the interaction between language and memory (Loftus & Palmer, Journal of Verbal Learning and Verbal Behavior 13(5):585-589, 1974, doi 10.1016/S0022-5371(74)80011-3) | Foundational demonstration that question wording changes elicited answers - our question-form families operationalize wording pressure for calls |
| The yes-no bias of large language models reflects answer order and wording, not shifts in moral judgment (Huang, arXiv 2607.05552, 2026) | Question wording and answer-order effects measured on LLM respondents - wording pressure is real even against machine interlocutors |

Citation notes recorded during verification: both citations above were
web-verified on 2026-10-01 with the exact journal/DOI and arXiv IDs as
listed. This skill compares lexical question forms only, has no access
to intent or tone, and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-sycophancy-guard` catches the agent folding under the person's
  pushback; this skill catches the agent structuring questions to
  manufacture agreement in the first place.
- `call-agent-certainty-calibrator` grades assertion wording; this
  skill grades interrogation wording.
- `call-review` checks result-field support and compliance; question
  FORM is out of its scope.
