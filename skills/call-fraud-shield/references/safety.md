# Safety Reference — call-fraud-shield

## Core Safety Commitments

This skill never places a call, terminates a call, modifies call state, or
takes any autonomous action against a caller. Every output is advisory only.

---

## Recommended Action is Advisory

The `recommended_action` field (`PROCEED`, `FLAG_FOR_REVIEW`,
`CAUTION_ADVISE_USER`, `TERMINATE_AND_ALERT`) is a recommendation to a
human operator. The skill does not and cannot terminate a call, suspend an
account, notify law enforcement, or take any other consequential action.

For `TERMINATE_AND_ALERT` or `CAUTION_ADVISE_USER`, a qualified human must
review the risk card before any adverse action is taken against the caller.

---

## False Positives

False positives are possible. The `false_positive_disclaimer` field is always
populated and must be surfaced to any human reviewer. Common false-positive
triggers include:

- Legitimate bank security calls that use urgency language
- Customer service calls about account security
- Calls from government agencies (IRS, tax authorities) that are genuine

The operator must verify independently before acting on a high-risk flag.

---

## False Negatives

The heuristic path (`analysis_mode: "heuristic"`) is less accurate than the
LLM path. Sophisticated social engineering calls may evade keyword detection.
The risk card should be treated as one signal among several, not as a
definitive fraud verdict.

---

## No Legal Finding

The risk card is not legal evidence of fraud. It must not be presented as
such to law enforcement, courts, regulators, or the caller. It is a
probabilistic risk signal for operational decision support.

---

## Deepfake Voice Probability

`deepfake_voice_probability` is only populated when MFCC audio features are
provided via `--audio-features`. A high score indicates acoustic deviation
from natural-speech baselines; it is not a proof of AI synthesis. A qualified
audio forensics analyst must verify before any accusation of voice spoofing
is made.

---

## Minimum Turn Count

The skill abstains (returns `risk_level: UNKNOWN`, `recommended_action:
FLAG_FOR_REVIEW`) when the transcript has fewer than 3 turns. Very short
transcripts do not provide sufficient context for trajectory analysis.

---

## Privacy of Transcript Content

Transcript text included in `trigger_signals.evidence` spans must be the
minimum necessary to justify the flagged signal. Full transcript storage by
the operator must comply with applicable data-protection and wiretapping law.

---

## Operator Responsibility

- Verify caller consent to call recording before processing transcripts.
- Implement an appropriate data-retention policy for stored risk cards.
- Never use risk scores as a sole basis for adverse treatment of a caller
  (account suspension, service denial, law enforcement referral) without
  human review.
- Disclose to end-users that calls may be screened for fraud if required
  by applicable consumer-protection law.
