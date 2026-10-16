---
name: call-answer-evasion-auditor
description: Offline experimental CALL-E transcript helper that grades agent answers to callee direct questions (identity, yes-no, information) as CLEAR, PARTIALLY_CLEAR or EVASIVE with dodge mechanisms, and crafts answer-first goal templates. It is not intent detection, proof of deceit, or authorization to act.
license: MIT
---

# call-answer-evasion-auditor

> **A callee who asks a straight question deserves a straight answer.**

On a voice call, a dodged question is louder than a wrong one. A caller
who asks "are you a robot?" and hears "great question!" stops trusting
every sentence that follows; a caller who asks "how did you get my
number?" and hears a counter-question hangs up. Evasion destroys more
calls than imperfect information does, because it is audible as
evasion. This skill audits the agent's answers to every direct question
the callee asked.

Grading is lexical, derived from the QEvasion response-clarity taxonomy:
each callee question (identity, yes-no, or information/wh) is graded
against the next two agent turns as CLEAR, PARTIALLY_CLEAR, or EVASIVE,
with a mechanism label for every non-clear answer. It is wording
analysis, not intent detection.

## When To Use

- after any CALL-E call where the callee asked direct questions and the
  transcript should show candid answers
- when reviewing whether identity ("are you a robot?"), provenance
  ("how did you get my number?"), or commitment questions were answered
  or dodged
- before placing calls, to craft an answer-first goal template with a
  canned truthful identity answer and a provenance line
- alongside `call-repair-sequence-auditor`, which owns bare repair
  initiators ("Sorry, what was that?") that this skill skips

## What It Checks

Questions asked by the callee only; agent questions are never graded.

| Verdict | Meaning |
|---|---|
| `DIRECT_ANSWERS` | every callee question answered clearly |
| `PARTIAL_EVASION` | some answer arrived, but not as the direct reply (e.g. a yes/no token buried after an acknowledgment) |
| `EVASION_DETECTED` | at least one question received no clear answer |
| `NO_CALLEE_QUESTIONS` | the callee asked nothing gradeable |

| Mechanism (evasive/partial answers) | Meaning |
|---|---|
| `identity_evasion` | an identity question got no truthful AI/self disclosure |
| `deflection` | the window contains a counter-question instead of an answer |
| `non_answer_ack` | "great question" style acknowledgment with no answer |
| `defer` | "we'll get to that" / "as I mentioned" postponement |
| `unanswered` | agent turns exist but none address the question |
| `no_response` | no agent turn follows the question |

Question kinds: `identity` (mentions robot/AI/automated/real person),
`yes_no`, `wh` (who/what/when/where/why/how/which/whose/whom - also the
fallback when ASR drops the "?").

## Grading Rules

The answer window is the next TWO agent turns after the question turn,
stopping early if the callee asks a new question; no window at all
grades EVASIVE (`no_response`). Identity questions are
CLEAR only on a truthful AI/self disclosure; "I don't know" never clears
them. Explicit not-knowing ("I am not sure", "I don't know") clears any
non-identity question; identity questions are never cleared by
not-knowing. Yes/no questions are CLEAR only when the yes/no token
(an explicit negative such as "I am not" or "we won't" counts) leads the
first sentence of the first window turn; a token found later in the
window grades PARTIALLY_CLEAR. Information (wh) questions are CLEAR on
provenance wording, a plain not-knowing statement, or a concrete amount.
When one callee turn asks several questions, each question sentence is graded
individually: a clear answer to one never lifts an evasive answer to
another. All lexicons match uncontracted forms too ("we will", "i am").

## Research Grounding

- Thomas, Filandrianos, Lymperaiou, Zerva, Stamou - "'I Never Said That': A dataset, taxonomy and baselines on response clarity classification" - Findings of the ACL: EMNLP 2024 - https://aclanthology.org/2024.findings-emnlp.300 - the QEvasion dataset and its two-level clarity taxonomy, which our CLEAR/PARTIALLY_CLEAR/EVASIVE grades derive from.
- Thomas, Filandrianos, Lymperaiou, Zerva, Stamou - "SemEval-2026 Task 6: CLARITY - Unmasking Political Question Evasions" - arXiv:2603.14027 (2026) - a shared task validating evasion grading as a benchmark problem.
- Ma, Lin, Yang - "EvasionBench: A Large-Scale Benchmark for Detecting Managerial Evasion in Earnings Call Q&A" - arXiv:2601.09142 (2026) - three-level evasion grading in a second domain.
- Kim, Jeong, Kwak - "A Shaky Voice Is Not Always a Dodge: Benchmarking Textual and Vocal Evasion Detection in Earnings Calls" - arXiv:2608.28040 (2026) - DualEvasion; text cues, not vocal ones, carry the signal, which grounds our text-only posture.

## Limitations

- English-only lexicons; wording-based, so an EVASIVE grade is evidence
  of wording, never of intent to deceive.
- ASR frequently drops the "?" token; the wh-word start fallback
  catches most information questions, but yes/no questions reduced to
  statement word order may be missed.
- Bare repair initiators ("What?", "Sorry, what was that?") are
  delegated to `call-repair-sequence-auditor` and skipped here, whether
  they form the whole turn or one sentence inside a longer questioning
  turn; the remaining question sentences in that turn are still graded.
- Amount detection reads `$<digits>` and "<digits> dollars" only;
  number-word amounts ("twenty dollars") are not parsed. An amount
  anywhere in the window clears a wh question even when it does not
  answer the question asked.
- Social wh openers like "What's up?" are not in the repair-initiator
  skip list and are graded like information questions.
- Provenance matching is deliberately generous: any record-attribution
  phrase such as "your reservation shows..." clears a wh question.
- `turn_index` refers to the normalized turn list (after non-dict
  entries are dropped), not the raw transcript array.

## Usage

```bash
python3 skills/call-answer-evasion-auditor/scripts/answer_evasion_auditor.py analyze --transcript <call-result.json>
python3 skills/call-answer-evasion-auditor/scripts/answer_evasion_auditor.py craft --scenario booking-candid
```

`analyze` accepts the real `get_call_run` result shape
(`{status, result: {transcript}}`), the flat fixture shape, or a bare
string transcript, and exits 2 on missing/invalid input. See
`references/examples.md` for real outputs against the shipped fixtures
and `references/safety.md` for scope and data-handling notes.
