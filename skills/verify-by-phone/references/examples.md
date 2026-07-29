# Examples

All phone numbers below are reserved fictional numbers. Every example except the live-call step runs with no credentials and no network.

## Example 1: dry run, then a live verification call

```bash
python3 scripts/place_verify_call.py \
  --org "Example Counseling Center" \
  --phone "+15550101234" \
  --claim-accepting-new-patients yes \
  --claim-plan "Example Health PPO"
```

Prints the full disclosure-first task text and the masked recipient, dials nothing. When the task reads right:

```bash
export CALLE_API_KEY=your-key
python3 scripts/place_verify_call.py ... --live
python3 scripts/poll_result.py --call-id call_abc123 --out result.json
```

## Example 2: extraction with a supporting span

```bash
python3 scripts/extract_answer.py --payload result.json --qhat 0.750
```

```json
{"claim": "accepting_new_patients", "answer": "yes", "trust_score": 0.9,
 "hedged": false,
 "span": {"turn": 6, "text": "Yep.", "char_start": 0, "char_end": 3},
 "abstain": false, "gate": "conformal(qhat=0.750)"}
{"claim": "accepts_plan", "answer": "unknown", "trust_score": 0.6,
 "hedged": false, "span": null, "abstain": true, "gate": "conformal(qhat=0.750)"}
```

The second line is the design working as intended: the call never asked about the plan, so the answer is an abstention, not a guess.

## Example 3: reconciliation verdict with visible arithmetic

`--qhat` is required. Reconciliation runs extraction itself, and an uncalibrated extractor abstains on every claim, so without a threshold this script could only ever print UNVERIFIABLE.

```bash
python3 scripts/reconcile_record.py --payload result.json --qhat 0.750 \
  --claim-accepting-new-patients yes --claim-plan-accepted yes
```

```text
prior: +0.00 bits (50/50 audit odds)
accepting_new_patients: call=yes record=yes -> +1.36 bits
accepts_plan: no evidence, the call did not establish this (record says yes)
posterior: +1.36 bits = 72% record-accurate
verdict: UNVERIFIABLE
```

Two fields, two different reasons, and the output distinguishes them. The first carried real evidence and moved the posterior. The second was never established by the call, so it contributes exactly zero rather than being counted as a disagreement. The verdict stays UNVERIFIABLE because 72 percent does not clear the 85 percent bar (`VERIFIED_AT` in `reconcile_record.py`, with `CONTRADICTED_AT` at 30 percent). One agreeing field is not enough to bless a listing, and partial evidence is reported as partial rather than rounded up.

## Example 4: calibrating the abstention threshold, no credentials

```bash
python3 scripts/calibrate.py --data references/sample-scenarios.jsonl --alpha 0.1
```

```text
calibration n=30, held-out test n=30 (disjoint)
alpha=0.1: qhat=0.750
empirical coverage: 90.0% (target 90%)
abstention rate: 60.0%
accuracy when answering: 100.0%

Apply it:  extract_answer.py --payload result.json --qhat 0.750
```

Read the two middle numbers together. Coverage lands on the 90 percent target, and the price of that guarantee is abstaining on 60 percent of the bundled scenarios. That is the trade the threshold exists to make: the scenario set is deliberately full of hedges, contradictions, and dead ends, so a high abstention rate on it is the system working rather than failing. Accuracy is 100 percent on the answers it does give.

Replace the bundled fictional scenarios with labeled outcomes from your own domain before relying on the threshold in production. Expect a different abstention rate: it is a property of your calls, not of the method.
