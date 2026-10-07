---
name: call-post-summary-faithfulness-auditor
description: Offline experimental CALL-E helper that decomposes the agent post_summary into atomic claims and anchors each against the transcript, flagging unsupported and outcome-contradicted statements before automation acts on them, plus a faithful-summary goal template. It is not semantic entailment, proof of lying, or authorization to act.
license: MIT
---

# call-post-summary-faithfulness-auditor

> **The post_summary is the only artifact most automations ever parse.
> Audit it, claim by claim.**

Every CALL-E application downstream of a call reads the agent-written
`post_summary` blindly: outcome tokens route workflows, amounts and dates
feed writebacks, action promises become follow-up tasks. If the agent
hallucinates in that free-text field - a dollar figure nobody spoke, a
"confirmed" that was really a voicemail - the hallucination silently
becomes a wrong action. No existing sibling skill audits the summary
itself: `call-review` gates schema fields, `verity` gates a single
`task_completed` claim, and the PR-gated null-result helpers gate
*missing* extraction. This skill catches the opposite failure - fabricated
content that made it into the record.

## When To Use

- before any workflow acts on the `post_summary` - writebacks, outcome
  parsing, CRM updates, follow-up scheduling
- after any call whose result feeds automation, as a gate between
  `get_call_run` and the action layer
- when an outcome token appears in the summary with no matching
  conversation anywhere in the transcript

## When Not To Use

- when semantic nuance matters; anchoring is lexical, so a faithful
  paraphrase can read as UNSUPPORTED - human review decides, always
- to prove the agent intended to deceive; this is claim anchoring, not a
  lie detector or an intent test
- on masked spans; phone digits are masked before analysis by design and
  are unverifiable by the same token

## Verdicts

| Verdict | Meaning | Suggested routing |
|---|---|---|
| `FAITHFUL` | every checkable claim anchored to a transcript turn | proceed, keep the card as evidence |
| `UNSUPPORTED_CLAIMS` | at least one claim value not found verbatim in any turn | hold the writeback; verify each flagged claim against the call record |
| `CONTRADICTED_CLAIMS` | an outcome claim conflicts with late callee speech under the polarity rule | block automation; a human must read the call |
| `NO_CHECKABLE_CLAIMS` | nothing machine-checkable: `reason` is `summary_missing` (empty field) or `opinion_only` (no anchored values) | do not infer an outcome from the summary; use the structured outcome fields |

## How It Works

Three deterministic stages, offline, no LLM:

1. **Mask first.** Any 7+-digit run (separators included) is masked in
   the summary and every turn before any claim work, keeping the last two
   characters. Phone numbers can never anchor and never leak into cards.
2. **Decompose.** Each summary sentence becomes atomic claims by kind -
   `outcome` (confirm/cancel/decline/reschedule/... with a polarity),
   `numeric` ($X, party of N, unit-suffixed counts), `date_time`
   (month-day, weekday, clock times with normalized meridiem), `action`
   (will send/email/call back/...), plus explicitly `non_checkable`
   notes for spelled numbers and pure-opinion sentences.
3. **Anchor.** Each claim is folded (case, meridiem, month names, digit
   commas) and searched across all turns. Outcome claims additionally
   check polarity against callee negatives in the final third of the
   call. Numerics never contradict - two different values can legitimately
   coexist in a call, so a value either anchors or reads UNSUPPORTED.

The card reports per-claim grades, per-grade counts, an overall verdict,
a `coverage_gaps` list (the transcript contains an outcome word the
summary never mentioned), and a fixed honesty disclaimer.

## Craft: the faithful-summary goal

```bash
python3 scripts/post_summary_faithfulness_auditor.py craft \
  --task "Confirm the reservation" \
  --facts "party of 4; Wednesday October 14; 2 p.m.; $20 deposit" \
  --outcome-token CONFIRMED
```

Emits a `plan_call` goal whose SUMMARY DISCIPLINE block constrains the
agent to restate only what was spoken aloud, repeat numbers as digit
words, never introduce an unspoken value, and state the outcome word
exactly once - so the summary this skill later audits starts faithful.

## Limitations

- spelled numbers ("four", "twelve") are flagged but not machine-checkable
- paraphrase misses: "half past two" will not anchor a "2 p.m." claim
- UNSUPPORTED is not proof of falsehood; the value may exist in audio
  nuance the transcript renders differently
- date formats are month-day, weekday, and clock forms only; ISO dates
  and relative dates ("next Friday") are out of scope
- contraction and negation edge cases ("can't" vs "cannot") may slip past
  the polarity regexes in rare phrasings

## Testing

```bash
python3 scripts/test_post_summary_faithfulness_auditor.py
```

Covers masking, decomposition, anchoring, polarity contradiction, verdict
routing, the CLI surface, and craft output against the bundled fixtures.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Long-form factuality in large language models (Wei, Yang, Song, Lu, Hu, Huang, Tran, Peng, Liu, Huang, Du, Le. NeurIPS 2024, arXiv 2403.18802) | Claim-decomposition plus per-fact verification (SAFE): long free text is graded by splitting it into atomic facts and checking each independently - exactly this skill's stage model |
| MiniCheck: Efficient Fact-Checking of LLMs on Grounding Documents (Tang, Laban, Durrett. EMNLP 2024, arXiv 2404.10774) | Grounding-document fact-checking as a defined task and the LLM-AggreFact benchmark - summary claims checked against a grounding source before the text is used |
| SummaC: Re-Visiting NLI-based Models for Inconsistency Detection in Summarization (Laban, Schnabel, Bennett, Hearst. TACL vol. 10, 2022, arXiv 2111.09525) | Summary-vs-source consistency as a formal summarization requirement - the post_summary is a summary and the transcript is its source |

This skill is the deterministic, offline, lexical-anchoring variant of
that methodology - not a learned model. Every output is labeled with a
fixed disclaimer stating exactly that.
