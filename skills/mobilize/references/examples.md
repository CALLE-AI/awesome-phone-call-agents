# Examples

Two worked mobilizations, run against the built-in simulator. Phone numbers
below use the reserved `555` range, so nothing here rings a real handset.

## 1. Simulated donor mobilization, filled in one wave

```bash
python -m mobilize.app.cli --pool-size 150 --need-count 3 --seed 7
```

```text
Generating a simulated donor pool of 150 (seed=7)...
Need: 3 confirmed donors, budget 40 calls, deadline 60 min.

── wave 0: dialing 6 candidates in parallel
  donor_0111   firm_yes     commitment=0.90
  donor_0006   firm_yes     commitment=0.91
  donor_0146   soft_yes     commitment=0.48
  donor_0081   no_answer    commitment=0.00
  donor_0012   firm_yes     commitment=0.92

✓ need met — 3 confirmed at 0.3s. No further wave will be dispatched.
  donor_0057   no           commitment=0.00

Filled: True   Confirmed: 3/3   Calls used: 6   Waves: 1
Over-recruitment ratio: 2.00x
```

Three firm confirmations landed in the first wave, so the sixth candidate's
result arriving slightly late made no difference — wave 2 was never
dispatched. This is the mechanism the whole skill is built around: stop
calling the moment the need is met, not the moment you run out of budget.

## 2. Calling `mobilize_real` via MCP, with explicit numbers only

An agent with the MCP server running (`python -m mobilize.mcp.server`) can
trigger a real mobilization, but only to numbers it is explicitly given:

```json
{
  "tool": "mobilize_real",
  "arguments": {
    "need_label": "Confirm availability for an urgent shift",
    "phones": ["+15550101234"],
    "count": 1,
    "deadline_minutes": 30
  }
}
```

Response, need not met (commitment scored below the confirmation threshold):

```json
{
  "filled": false,
  "confirmed_count": 0,
  "calls_used": 1,
  "confirmed": []
}
```

This is not a bug: `mobilize` treats a hedged "yes" ("I'll try", "maybe") as
a `soft_yes`, and only counts a response toward the need once its calibrated
commitment score clears the confirmation threshold. A real run against a
recipient's own number produced exactly this outcome during development —
see `mobilize/artifacts/smoketest_2_result.json` in the app directory for
the full transcript and score.

## What not to do

```text
Bad:  Passing a whole roster/registry object to mobilize_real and letting it
      infer the pool.                    (mobilize_real never expands beyond
                                           the exact phones list given)
Bad:  Treating any stated "yes" as a confirmation.
                                          (defeats the entire point of the
                                           commitment model -- use `filled`
                                           and `confirmed`, not `stated_yes`)
Bad:  Claiming a mobilization "cancelled" calls once the need was met.
                                          (CALL-E's API has no cancel
                                           operation; mobilize stops
                                           dispatching further waves --
                                           calls already placed run to
                                           completion)
Good: "3 of 3 confirmed, firm commitment, wave 2 never dispatched -- 34
      other candidates in the pool were never called."
```
