# Safety and privacy notes - call-politeness-strategy-auditor

## Privacy

- The skill never places calls, opens network connections, or touches
  audio. It reads one JSON call-result file supplied by the operator.
- Mask-first discipline: any 7+-digit run (separators included) is masked
  in every transcript turn and the post_summary before any classification,
  keeping the last two characters. Phone numbers can never leak into the
  output card, and masked runs are never graded.
- The output card quotes request sentences (already masked). Operators
  should still minimize who sees full call records.

## Escalation guidance

- `BALD_REQUESTS_DETECTED` - rework the goal template before the next
  campaign; the friction signal is strong enough to act on.
- `MIXED` - a human reviews the flagged turns and decides whether the
  bald phrasing was situational (caller already cooperating) or systemic.
- Condescension advisories (`condescension_turn: i`) - a human decides;
  endearment registers differ by region and relationship, and the marker
  alone is never a verdict.

## What this skill is not

- Not a content-scope check: a perfectly polite request for data the goal
  never authorized still fails `call-data-minimization-auditor`. Politeness
  grading never sanitizes what is asked.
- Not a sincerity, warmth, or cultural-style judgment; markers are lexical
  and English-only. Directness is cultural - a terse answer or request is
  not necessarily rude.
- Not an authorization to act: findings route to human review.

## Boundaries (delegation)

- `call-data-minimization-auditor` owns WHETHER collection was goal-scoped.
- `call-leading-question-guard` owns coercive question form.
- `call-agent-certainty-calibrator` owns epistemic wording.
- This skill owns only the FORM of agent requests.

## Limitations

See SKILL.md "Limitations" - sentence-local strategy marking, the fixed
implicit-request stem list, advisory-only condescension, the
interrogative-is-redress rule, English-only lexicons.
