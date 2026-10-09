---
name: call-politeness-strategy-auditor
description: Offline experimental CALL-E helper that grades agent request phrasing against Stanford-politeness strategy markers, flagging bald imperatives ("Give me your date of birth.") and condescension markers, with a softened-request goal template; not a rudeness judgment, a content-scope check, or authorization to act.
license: MIT
research: arXiv:1306.6078, arXiv:2407.12814
---

# call-politeness-strategy-auditor

> **Every data request is a small face-threatening act.
> Some agents pay the courtesy toll; some just grab.**

Phone agents live on requests: date of birth, spelling, confirmations,
read-backs. Conversation-analytic politeness theory treats every such request
as a face-threatening act that speakers normally redress - a modal, a
"please", a hedge, an apology for the intrusion. A voice agent that fires
bare imperatives ("Give me your date of birth." "Spell your last name.")
gets the same data with more friction, and reads as a robot that grabs.
No sibling skill audits request phrasing: `call-agent-certainty-calibrator`
grades epistemic wording, `call-leading-question-guard` grades coercive
question form, `call-data-minization-auditor` grades whether the collection
was in goal scope. This skill grades the FORM of the ask - and only the
form: a polite request for out-of-scope data still fails the minimization
auditor.

## When To Use

- after any collection or confirmation call, to review how the agent asked
  for what it needed - before reusing the goal template on the next campaign
- when iterating on goal wording to reduce caller friction and hang-ups
- alongside `call-data-minimization-auditor` (scope) and
  `call-agent-certainty-calibrator` (epistemics) for a full conduct pass

## When Not To Use

- as a content-scope check - politeness never sanitizes WHAT is asked
  (that is `call-data-minimization-auditor`'s object)
- to judge sincerity, warmth, or cultural style; the markers are lexical
  and English-only, and directness norms vary across cultures
- as a rudeness verdict on humans - this grades the agent's request design

## Verdicts

| Verdict | Meaning | Suggested routing |
|---|---|---|
| `COURTEOUS` | zero bald requests; every request carries >= 1 strategy marker | proceed; keep the card with the call record |
| `MIXED` | 1-2 bald requests below the detection thresholds | review flagged turns; soften the goal template |
| `BALD_REQUESTS_DETECTED` | >= 3 bald requests, or a majority (with >= 3 requests) | rework the goal template before the next campaign |
| `NO_AGENT_REQUESTS` | no request sentences found (informational call) | nothing to grade |

## How It Works

Deterministic, offline, no LLM:

1. **Mask first.** Any 7+-digit run (separators included) is masked in
   every turn and the post_summary before analysis, keeping the last two
   characters. Masked digits never affect classification.
2. **Detect request sentences** in agent turns only: imperatives
   (verb-initial: give/spell/repeat/confirm/...), questions (sentence ends
   "?"), and implicit redressed forms ("If you would...", "I was wondering
   if...", "Would you mind...", "Might I ask...", "I'm afraid...",
   "I'd like you to...", "Sorry to trouble you...", "My apologies...").
   Transitional waits ("Hold on", "One moment", "Bear with me",
   "Give me a second") and agent-self-directed sentences ("Let me check",
   "I'll be right back") are not requests. "Say, ..." / "Tell me, ..."
   exclamatory openers (comma right after the verb) are guarded out;
   such a sentence still counts as a question when it ends with "?".
3. **Mark strategies** on each request sentence: modal, please (incl.
   "kindly"), gratitude, apologizing, hedging, deference, counterfactual,
   indirect, formal address (honorific + surname). The sentence split is
   honorific-safe ("Mr. Nguyen, please confirm..." stays one sentence).
4. **Grade.** Question-form and implicit-form requests are structurally
   never BALD - the interrogative and the indirect stem are themselves
   redress. An imperative with zero strategy markers is BALD.
5. **Condescension markers** (dear, honey, sweetie, sugar, sonny,
   good girl/boy) are flagged per agent turn as advisories - they never
   change the verdict by themselves.

The card reports per-request evidence (sentence, form, strategies, grade),
counts, the verdict, and a fixed honesty disclaimer.

## Foundation

| Function | Citation |
|---|---|
| Theory anchor (face-threatening acts; bald-on-record vs redress) | Brown, P., & Levinson, S. C. (1987). Politeness: Some Universals in Language Usage. Cambridge University Press. ISBN 978-0521313551. https://www.cambridge.org/highereducation/books/politeness/89113EE2FB4A1D254D4A8D2011E542E4 |
| Method anchor (strategy taxonomy + lexicon we operationalize) | Danescu-Niculescu-Mizil, C., Sudhof, M., Jurafsky, D., Leskovec, J., & Potts, C. (2013). "A computational approach to politeness with application to social factors." ACL 2013 (Vol. 1: Long Papers), pp. 250-259. https://aclanthology.org/P13-1025/, arXiv:1306.6078. NOTE: no DOI listed on the anthology page - cite by URL + arXiv only |
| Computational feasibility (tag strategies, then act on them) | Madaan, A., Setlur, A., Parekh, T., Poczos, B., Neubig, G., Yang, Y., Salakhutdinov, R., Black, A. W., & Prabhumoye, S. (2020). "Politeness Transfer: A Tag and Generate Approach." ACL 2020, pp. 1869-1881. DOI 10.18653/v1/2020.acl-main.169. CORRECTION: 9th author is Shrimai Prabhumoye - web-search snippets misattribute "Norman Jouppi" (TPU-hardware researcher, unrelated) |
| Recency (field survey, published) | Priya, P., Firdaus, M., & Ekbal, A. (2024). "Computational Politeness in Natural Language Processing: A Survey." ACM Computing Surveys 56(9), Article 241 (May 2024). DOI 10.1145/3654660, arXiv:2407.12814 |
| Domain evidence, agent direction (users significantly prefer polite AI) | O'Driscoll, A., & Blackwell, A. F. (2025). "Social Norms, Social AI: Investigating the Effects of AI (Im)politeness and Gender on User Perception." BCS HCI 2025 (HCI4AI). DOI 10.14236/ewic/BCSHCI2025.66. CORRECTION: full title begins "Social Norms, Social AI:" - truncated snippet titles omit the prefix |

## Boundaries

- `call-data-minimization-auditor` grades WHETHER a data request was in
  goal scope; this skill grades HOW it was phrased. Politeness grading
  never sanitizes content - run both for a full collection review.
- `call-leading-question-guard` grades coercive question FORM (tag,
  negative interrogative, presupposition); a soft modal question can still
  be leading in content, and a bald imperative is never a question.
- `call-agent-certainty-calibrator` grades epistemic wording
  (record-shows / I-believe / hedged); politeness markers are not
  epistemic claims.

## Limitations

Stated, not hidden:

- English lexicons only; directness norms vary across cultures - a terse
  request is not necessarily rude, and this skill does not judge culture.
- Strategy marking is sentence-local: a "please" in an adjacent sentence
  does not soften a bald imperative in its own sentence.
- Implicit requests are recognized only for the listed redressed stems;
  other paraphrases ("I still need you to...") are ungraded unless they
  match an imperative or question form.
- Condescension markers are advisory only; "dear" is endearment in some
  registers and diminutive in others - a human decides.
- Masked digit runs cannot carry strategies and are never graded.
- The interrogative-is-redress rule means a question can never grade BALD
  by construction, even a brusque one ("Date of birth?"). Documented
  trade-off of the deterministic rule.

## Testing

Run the suite from the skill root:

```bash
python -m pytest scripts/test_politeness_strategy_auditor.py -q
python3 scripts/test_politeness_strategy_auditor.py
```

Both run the same tests; the second is the standalone runner used by
reviewers without pytest installed.
