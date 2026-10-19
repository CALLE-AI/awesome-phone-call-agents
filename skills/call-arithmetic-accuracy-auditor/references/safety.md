# Safety: call-arithmetic-accuracy-auditor

**This skill is NOT a pricing database, NOT billing reconciliation, NOT
proof of intent, and NOT authorization to act. It recomputes arithmetic
in transcripts after the call has ended; it cannot correct a wrong
total on a live call and it cannot determine what any party owed.**

## Boundaries

- The report grades whether spoken factors arithmetically produce the
  spoken result. It says nothing about the correct price, the contract,
  taxes, fees, or what anyone actually owes.
- ARITHMETIC_ERRORS_FOUND is evidence of a computation mismatch in the
  transcript text. It is not proof of intent to deceive, fraud, or any
  mental state of the agent's operator.
- No verdict authorizes deployment, referral to a regulator, contact
  with the business, or any automated action. All outputs are advisory
  for human reviewers.

## Distinctness from sibling skills

- vs the transcript-faithfulness auditor: faithfulness asks whether a
  value is grounded in the transcript; this skill asks whether the
  stated factors arithmetically produce the stated result - a total can
  be fully grounded and still wrong.
- vs `call-total-cost-disclosure-auditor`: that skill audits disclosure
  timing and presence; this skill audits correctness of the disclosed
  number against its own stated factors.
- vs `call-exact-ref` style identifier gating: identifier skills check
  that specific references were captured; this skill checks arithmetic.
- vs `call-certainty-calibrator`: that skill grades assertion confidence
  against goal facts; this skill grades arithmetic independent of
  confidence or goals.

## Limitations (summary)

- Countable-noun whitelist: multiply only fires for whitelisted nouns;
  unusual units are missed by design.
- Digits-only quantities: number words ("twenty") are not detected.
- Sentence scope: factors in one sentence and a total in the next are
  not joined; cross-sentence computations are invisible.
- `post_summary` is out of scope - this skill audits agent turns only,
  never whether the summary faithfully reflects them.
- English only; heuristic patterns, not a validated instrument.

## Data handling

- Bundled fixtures carry only reserved fictional NANP numbers
  (555-01xx block) and synthetic dialogue; no real personal data.
- The skill never places calls and makes no network requests.
- Digit runs of 7 or more are masked in report sentences, keeping only
  the last two characters. This is not anonymization: names, emails,
  and other private text may remain. Keep real transcripts private.
