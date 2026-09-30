---
name: call-ai-disclosure-comprehension-auditor
description: Offline experimental CALL-E transcript helper that grades whether the agent disclosed being an AI, whether the disclosure came before business content, whether a comprehension question was asked, and whether an acknowledgment was captured, plus a disclosure-first goal template. It is not legal advice, jurisdiction-specific compliance certification, or proof the person did or did not understand.
license: MIT
---

# call-ai-disclosure-comprehension-auditor

> **Saying "this is an AI" is step one. Knowing it landed is the actual job.**

`call-review` checks that a disclosure exists somewhere in the agent's
turns. This skill audits the full sequence the law and the research both
point at: disclosure in the first breath, an explicit comprehension
question before any pitch, and a captured acknowledgment - and it writes
the opening that produces that sequence next time.

## When To Use

- after any CALL-E outbound call, to grade its disclosure posture
- before acting on a result where the callee's agreement matters - an
  agreement from someone who never knew an AI was speaking is fragile
- before placing calls, to craft an Article-50-style disclosure opening

## When Not To Use

- to certify legal compliance for any jurisdiction; the verdicts are
  transcript observations, and regulators - not scripts - decide
  compliance
- to prove the person did not understand; silence after a disclosure is
  not evidence of confusion, and the card says so
- during a call; this is strictly post-call analysis plus pre-call goal
  crafting

## Workflow

### Audit a finished call

```bash
python3 scripts/disclosure_comprehension_auditor.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `disclosure_present` / `disclosure_early` (first agent turn vs later)
- `comprehension_check_present` - an explicit question ("do you
  understand", "is that okay", "does that make sense") in the disclosure
  turn or the next agent turn, BEFORE business content: if digits (dates,
  amounts, times) already appear in the disclosure turn, the pitch came
  first and the check does not count
- `acknowledgment_captured` - an affirmative callee reply in the first
  callee turn after the check
- `evidence`: the disclosure / check / acknowledgment turns, masked
- `verdict`: `FULL` / `PARTIAL_NO_ACK` / `DISCLOSED_NO_CHECK` /
  `LATE_DISCLOSURE` / `UNDISCLOSED`, plus `unclear` paths for empty or
  agent-less transcripts

Only agent turns can disclose; a callee asking "are you a robot?" is not
disclosure and does not count.

### Craft the disclosure-first goal

```bash
python3 scripts/disclosure_comprehension_auditor.py craft --scenario disclosure-first-call
```

Emits the plan_call inputs JSON whose goal puts the disclosure in the
first sentence, pairs it with one comprehension question, and refuses to
proceed to business until the person acknowledges.

## Scientific and Regulatory Foundation

| Source | Relevance |
|---|---|
| Regulation (EU) 2024/1689 (AI Act), Article 50 | The transparency obligation this skill operationalizes on the transcript axis: AI systems interacting with natural persons must inform them; applicable from 2026-08-02 |
| European Commission Guidelines on Transparency Obligations (digital-strategy.ec.europa.eu) | Official interpretation accompanying Article 50 |
| Chen et al., The impact of artificial intelligence disclosure on user engagement, Computers in Human Behavior 2024, doi:10.1016/j.chb.2024.108448 | Empirical evidence that disclosure measurably changes user engagement - so WHERE and HOW it lands matters, not just whether it exists |
| Chen, Sun et al., The Effects of AI Identity Disclosure on User Responses: A Meta-Analysis, Information Processing & Management 2026 (PII S0378720626001114) | Meta-analytic effect sizes of disclosure on evaluations, attitudes, intentions, behaviors |

Citation notes recorded during verification: the two Chen-lineage papers
are distinct (a 2024 individual study in CHB with the exact DOI above, and
a 2026 IP&M meta-analysis); Article 50 obligations apply from 2 August
2026. California's B.O.T. Act (SB 1001, 2018) covers bot disclosure in
the US and is consistent with this design but is not separately cited in
the table. This skill implements a lexical approximation and labels every
output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-review` checks disclosure presence as one compliance line; this
  skill grades the full disclosure-comprehension-acknowledgment sequence
  and writes the compliant opening for the next call.
- `call-sycophancy-guard` protects factual integrity under pressure; this
  skill protects the conversational precondition - the person knowing who
  is talking - under which any agreement is meaningful.
