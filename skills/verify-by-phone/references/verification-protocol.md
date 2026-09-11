# The Verification Protocol

Why this skill is shaped the way it is.

## Disclosure first, always

Every call opens with identity and purpose in the same sentence: an automated assistant, calling to verify directory information, call may be recorded. This is stated before any question is asked. The respondent who objects gets thanked and released immediately, and the refusal is recorded as an unverifiable outcome, never as a data point about the underlying claim.

Two reasons. First, platform terms and the regulatory direction for automated calling require disclosure. Second, verification that depends on deception does not scale into anything an organization could actually operate. This protocol accepts a known limitation honestly: disclosed verification may elicit different answers than secret-shopper audits, and no undisclosed baseline exists inside this protocol to measure that difference. Operators who need that estimate should look to the published secret-shopper literature.

## Legal posture for outbound verification calls

- Call published organizational lines only, never wireless or personal numbers.
- Calls are informational verification, not marketing, promotion, or solicitation.
- Announce recording on every call and treat every call as requiring all-party consent.
- One call per record per authorization. No recurring dialing, no retry storms.
- The operator, a human, authorizes each recipient before any live call.

## Abstention is the product

A verification tool that guesses is just another source of bad data. The design rule throughout: no answer without either a verbatim supporting span from the transcript or an explicit abstention.

- Hedged answers ("I think so", "probably") keep their polarity at a dampened trust score. Whether a dampened score still clears the answering bar is decided by calibration, not vibes.
- Non-responsive turns (wrong number, refusal, "you'd have to call back") never count as answers, even when they contain polarity words. "There's no doctor's office here" is not a no.
- Contradictory answers within one call collapse to a low-trust result that calibration will typically turn into an abstention.

## What calibration buys

`scripts/calibrate.py` implements split conformal prediction with the finite-sample correction. Given labeled scenarios split into disjoint calibration and test folds, it produces a threshold with a distribution-free guarantee: at miscoverage alpha, the true answer falls inside the prediction set at least (1 - alpha) of the time on held-out data. The system answers only when that set is a single value and that value is not "unknown", and abstains otherwise. A singleton {unknown} is an abstention, not an answer: counting it as answered would report a lower abstention rate than an operator actually experiences. The same gate.py that computes this threshold decides every served answer, so the guarantee described here is the guarantee applied. This converts "how confident are we?" from a feeling into a measured coverage number an operator can set policy against.

## Reconciliation arithmetic

`scripts/reconcile_record.py` uses Fellegi-Sunter style match weights with fixed, documented (m, u) parameters and a stated 50/50 prior, chosen deliberately: federal audits have found roughly half of provider directory listings inaccurate, so an uninformative prior is the honest one. Every verdict decomposes into per-field bits of evidence an operator can audit line by line. Unknowns contribute exactly zero: no evidence is no evidence.
