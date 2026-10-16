---
name: call-correction-propagation-auditor
description: Offline experimental CALL-E helper that tracks agent self-corrections mid-call ("Sorry, I said Tuesday; I meant Thursday"), follows each correction chain, and verifies the corrected value - not the superseded one - reached the post_summary, flagging stale values before automation acts; not semantic repair analysis, proof of deception, or authorization to act.
license: MIT
research: arXiv:2310.01798, arXiv:2311.08516, arXiv:2605.06527
---

# call-correction-propagation-auditor

> **A mid-call correction that never reaches the record is a silent lie
> the summary tells.**

Every CALL-E application downstream of a call parses the agent-written
`post_summary` blindly: dates feed writebacks, times feed calendars,
amounts feed charges. Agents correct themselves mid-call all the time -
"Sorry, I said Tuesday; I meant Thursday" - and conversation-analysis
work shows speakers prefer exactly this self-repair form. But intrinsic
self-correction is unreliable: an agent that fixed its own error in
speech may still write the pre-correction value into the record, because
a later correction does not automatically invalidate the earlier stored
value in an LLM's context. The sibling
`call-post-summary-faithfulness-auditor` anchors each summary claim to
ANY occurrence in the transcript - so a summary carrying the
PRE-correction "Tuesday" still grades SUPPORTED, because "Tuesday" was
genuinely spoken. That is this skill's companion blind spot: faithfulness
to the transcript is not faithfulness to the correction. This skill
follows each agent self-correction chain and verifies that the final
corrected value - not the superseded one - reached the summary, before
automation acts on the stale one.

## When To Use

- before any writeback, calendar entry, or outcome parse acts on the
  `post_summary` of a call where the agent restated or corrected details
- after any call whose transcript shows the agent revising a date, time,
  amount, count, or address mid-conversation
- combined with `call-post-summary-faithfulness-auditor`: run both - the
  faithfulness auditor anchors claims correction-agnostically, this
  skill grades what happened to each correction

## When Not To Use

- when the CALLEE revised their answer ("Actually, make it Friday") -
  that is answer instability, the object of the provenance-grade skill
- when the CALLEE initiated the repair ("No, Thursday") - callee-side
  other-repair signals belong to `call-repair-sequence-auditor`
- for semantic repair analysis; marker detection is lexical, so a
  paraphrased correction can go undetected
- on masked spans; phone digits are masked before analysis by design and
  are unverifiable by the same token

## Verdicts

| Verdict | Meaning | Suggested routing |
|---|---|---|
| `STALE_VALUE_IN_SUMMARY` | a superseded value appears in the summary while the corrected one does not | block the writeback; a human must read the call |
| `CORRECTIONS_UNCONFIRMED` | a correction chain has no agent restate or callee ack within the confirmation window | verify the corrected value before acting |
| `PROPAGATED` | detected chains are confirmed and no stale-only summary value was found; summary checks may still be unreported or ambiguous | inspect every summary check and advisory; human review before acting |
| `NO_SELF_CORRECTIONS` | no agent self-correction detected; `reason` is `transcript_missing` (no turns) or absent (none detected) | no correction audit applies; run the faithfulness auditor |

## How It Works

Five deterministic stages, offline, no LLM:

1. **Mask first.** Any 7+-digit run (separators included) is masked in
   the summary and every turn before any correction work, keeping the
   last two characters. Phone numbers can never anchor and never leak
   into cards.
2. **Detect.** Agent-side sentences (questions excluded) are scanned for
   correction markers - `sorry_i_said`, `meant`, `not_x_but_y`,
   `y_not_x`, `correction`, `let_me_correct`, `incorrect`,
   `should_be`, `my_mistake`, `actually_its`, `scratch` - the first
   matching marker wins the sentence. Each marker binds an old and a new
   value of one kind (date, weekday, clock, money, count, street).
3. **Build chains.** Events whose old_value supersedes a chain's final
   or superseded value extend that chain; otherwise they start a new one
   - "Tuesday -> Thursday -> Friday" becomes one chain with two
   superseded values.
4. **Check propagation.** Each chain's final and superseded values are
   folded (case, meridiem to 24h, month names, digit commas) and
   searched in the folded summary with boundary guards ("14:00" does
   not match "2:14:00", "tuesday" does not match "tuesday's").
   Superseded-in-summary-without-final is stale; both is ambiguous;
   final-only is propagated; neither is unreported.
5. **Confirmation window.** A chain is confirmed when any later agent
   turn restates the final value, or a callee turn within turns i+1..i+2
   after the correction repeats it or acknowledges ("ok", "that works",
   "sounds good", ...). Unconfirmed chains cap the verdict at
   `CORRECTIONS_UNCONFIRMED` unless a stale value already blocks it.

The card reports per-event corrections, per-chain summary checks,
counts, an `advisories` list (`summary_missing`,
`unreported_chain: <value>`), and a fixed honesty disclaimer.

## Craft: the correction-discipline goal

```bash
python3 scripts/correction_propagation_auditor.py craft
```

Emits a `plan_call` goal whose CORRECTION DISCIPLINE block instructs the
agent - the moment it corrects any detail - to re-state the corrected
value in a full sentence, ask the caller to confirm it, and use only the
corrected value thereafter, so the summary this skill later audits
carries corrections forward instead of stale values.

## Limitations

- English correction lexicons only; corrections phrased outside the
  marker list go undetected
- spelled-out numbers ("four", "twelve") are not correctable values;
  this is documented as not graded; never guessed, not silently graded
- masked digit runs (phones, long numbers) are never correctable by
  design
- proximity resolution picks the nearest preceding same-kind value, so
  disjunctive lists ("Tuesday or Wednesday") may bind the wrong
  superseded value
- corrections packed with multiple value pairs in one sentence ("it's the
  21st, not the 16th, and 2 bags, not 3") may undercount - each marker
  binds one old/new pair
- weekday possessives and plurals ("Tuesday's") are treated as different
  tokens by the boundary rule and will not match a plain "Tuesday"
- agent corrections prompted by the CALLEE ("No, Thursday") are
  other-corrections and out of scope
- the whole audit is lexical, not semantic; a paraphrased correction or
  summary restatement can evade detection
- the aggregate `PROPAGATED` label does not prove every correction reached
  the summary; inspect each chain's summary check and the advisory list

## Testing

```bash
python -m pytest scripts/test_correction_propagation_auditor.py -q
python3 scripts/test_correction_propagation_auditor.py
```

The suite in `scripts/` covers masking, marker detection, chain
building, propagation outcomes, the confirmation window, verdict
routing, the CLI surface, and craft output against the bundled fixtures.

## Scientific Foundation

| Function | Citation |
|---|---|
| Method anchor (CA self- vs other-repair organization) | Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). "The Preference for Self-Correction in the Organization of Repair in Conversation." Language 53(2):361-382. DOI 10.2307/413107, https://www.jstor.org/stable/413107 |
| Failure-mode evidence (intrinsic self-correction unreliable - corrections must be tracked, not assumed to propagate) | Huang, J., Chen, X., Mishra, S., Zheng, H. S., Yu, A. W., Song, X., & Zhou, D. (2024). "Large Language Models Cannot Self-Correct Reasoning Yet." ICLR 2024. arXiv:2310.01798 |
| Craft-mode grounding (correction succeeds when the error location is explicit - hence re-state + readback instruction) | Tyen, G., Mansoor, H., Carbune, V., Chen, P., & Mak, T. (2024). "LLMs cannot find reasoning errors, but can correct them given the error location." Findings of ACL 2024. arXiv:2311.08516, https://aclanthology.org/2024.findings-acl.826 |
| Domain + recency (implicit-conflict failure: later observation fails to invalidate earlier stored value - exactly the stale summary value) | Chao, H., Bai, Y., Sheng, R., Li, T., & Sun, Y. (2026). "STALE: Can LLM Agents Know When Their Memories Are No Longer Valid?" arXiv:2605.06527 |

## Boundaries

- the provenance-grade skill grades CALLEE answer instability (its
  signal I); this skill audits AGENT self-corrections and the summary
  record - the two directions do not overlap
- `call-repair-sequence-auditor` detects CALLEE-initiated other-repair
  trouble signals; agent self-corrections are this skill's object
- `call-post-summary-faithfulness-auditor` anchors summary claims
  correction-agnostically - any transcript occurrence satisfies it, so a
  stale summary can still grade FAITHFUL; they compose, run both

This skill is the deterministic, offline, lexical-marker variant of
that methodology - not a learned model. Every output is labeled with a
fixed disclaimer stating exactly that.
