# Commitment Model

A stated "yes" from a phone call is a noisy signal, not a confirmation.
Acquiescence bias means people agree to be pleasant and then don't follow
through. `mobilize/core/commitment.py` scores how firm a stated yes actually
is, using two inputs:

1. **Language firmness** -- the call's `evidence_summary` (extracted by
   CALL-E's `result_schema`) is scanned for firm markers ("leaving now", "on
   my way", "absolutely") versus hedge markers ("I'll try", "maybe", "I
   think", "we'll see"). This produces a 0..1 firmness score via a simple
   sigmoid over marker counts.
2. **Historical prior** -- the candidate's `historical_showup_rate`, if
   known from past mobilizations.

`calibrated_commitment()` blends these (default 60% language, 40% prior).
Only results at or above `COMMITMENT_THRESHOLD` (0.55, in
`mobilize/core/dispatcher.py`) count toward the need being filled.

## Why this matters, measured

`mobilize/sim/harness.py` runs the identical dispatch code against a
synthetic population with a known, hidden ground-truth show-up probability
per candidate -- independent of how firmly they phrased their answer. It
compares three policies:

- **calibrated** -- this model
- **stated_yes_only** -- naive: any stated yes counts as confirmed
- **call_all** -- call the entire pool at once, ignore budgeting

The metric that matters is `confirmation_accuracy`: of the people the policy
believed were confirmed, what fraction would actually show up? Run
`python -m mobilize.sim.harness` to reproduce the current numbers on this
repository; see the top-level README for the last measured result.

## Validating the model against reality

The calibration curve (firm/hedge marker weights) is hand-tuned from the
phrase patterns used to generate the synthetic population
(`mobilize/sim/population.py`), not derived from real human speech. The
reality-validation step in the project plan -- checking real CALL-E call
outcomes against these scores -- is what confirms or corrects this model
against actual conversations, not just the simulator's own generative
assumptions.
