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

Both `--qhat` and `--org` are required, and for the same reason: reconciliation runs extraction itself, and extraction fails closed without a calibrated threshold and without a positive identity confirmation. Omit either and this script can only ever print UNVERIFIABLE.

Runs against the bundled sample with no credentials and no call:

```bash
python3 scripts/reconcile_record.py --payload references/sample-call.json --qhat 0.750 \
  --org "Example Family Medicine" \
  --claim-accepting-new-patients yes --claim-plan-accepted yes
```

```text
prior: +0.00 bits (50/50 audit odds)
accepting_new_patients: call=yes record=yes -> +1.36 bits
accepts_plan: call=no record=yes -> -2.32 bits
posterior: -0.96 bits = 34% record-accurate
verdict: UNVERIFIABLE
```

This is the interesting case rather than the flattering one. The record claimed both things; the call confirmed one and contradicted the other. Agreement on accepting new patients adds 1.36 bits, disagreement on the plan subtracts 2.32, and the disagreement weighs more because `(m, u)` for the plan field is set that way: plans change quietly and a directory is likelier to be stale about them.

Net 34 percent. That is below the 50 percent prior, so the listing is now doubted. It is nowhere near the 85 percent `VERIFIED_AT` bar, and it does not clear the 30 percent `CONTRADICTED_AT` bar either, so the verdict is UNVERIFIABLE rather than CONTRADICTED. Mixed evidence is reported as mixed. Rounding it either way would be the guess this tool exists not to make.

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
