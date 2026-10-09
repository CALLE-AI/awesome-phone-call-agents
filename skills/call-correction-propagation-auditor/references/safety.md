# Safety: call-correction-propagation-auditor

## Privacy

- Mask-first: any 7+-digit run (separators included) is masked in the
  post_summary and every transcript turn before any correction work
  begins, keeping only the last two characters. Phone digits can never
  anchor a correction and never appear in a card.
- This is a heuristic masker, not anonymization: names, emails, and
  short numeric fragments are out of its scope. Keep real transcripts
  and cards private; review them before sharing.
- The skill runs offline: no network requests, no audio access, no LLM
  calls. It reads one JSON file, prints one card, and exits.

## Escalation guidance

- `STALE_VALUE_IN_SUMMARY` blocks writebacks pending human review: the
  superseded value is in the summary and the corrected one is not, so
  automation acting on the summary would act on a value the agent
  itself already withdrew.
- `CORRECTIONS_UNCONFIRMED` requires readback verification: no later
  agent restate and no callee ack within the confirmation window, so a
  human must confirm the corrected value against the call record before
  it is trusted.
- No verdict is proof of deception; a stale value is a propagation
  failure, not evidence the agent intended to mislead.

## Boundaries

- Callee-revised answers ("Actually, make it Friday") are answer
  instability - the object of the provenance-grade skill; this skill
  audits agent self-corrections only, and neither skill substitutes for
  the other.
- Callee-initiated repair ("No, Thursday") is other-repair - the object
  of `call-repair-sequence-auditor`; this skill does not grade it, and
  repair-sequence auditing does not grade agent self-corrections.
- `call-post-summary-faithfulness-auditor` anchors summary claims
  correction-agnostically - it will grade a stale summary FAITHFUL
  because the superseded value was genuinely spoken; this skill closes
  that gap, and the two compose in both directions (run both).

## Limitations

- English correction lexicons only; corrections phrased outside the
  marker list go undetected.
- Spelled-out numbers ("four", "twelve") are not correctable values;
  documented as not graded; never guessed, not silently graded.
- Masked digit runs (phones, long numbers) are never correctable by
  design.
- Proximity resolution picks the nearest preceding same-kind value, so
  disjunctive lists ("Tuesday or Wednesday") may bind the wrong
  superseded value.
- Weekday possessives and plurals ("Tuesday's") are treated as different
  tokens by the boundary rule and will not match a plain "Tuesday".
- Agent corrections prompted by the callee ("No, Thursday") are
  other-corrections and out of scope.
- The whole audit is lexical, not semantic; a paraphrased correction or
  summary restatement can evade detection.
