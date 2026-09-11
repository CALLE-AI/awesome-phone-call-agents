# CallParity

CallParity is maintained in the upstream repository: [https://github.com/ruddro-roy/callparity](https://github.com/ruddro-roy/callparity).

This directory is a catalog pointer for Awesome Phone Call Agents. The portable engine in this fork is ClaimKill.

## What it does

CallParity spends the next CALL-E call to falsify one quoted freight claim. ClaimKill compiles that call as a leak-scored refute question, then merges Party B quotes into a claim graph.

## Portable skill

Agent workflow: [`skills/callparity-claimkill`](../../../skills/callparity-claimkill/).

Preview and pytest use committed fixtures. They place zero live CALL-E calls.

```bash
python3 skills/callparity-claimkill/scripts/claimkill.py preview --fixture FR-1842
python3 -m pytest skills/callparity-claimkill/tests/test_claimkill.py -q
```

## Default mode

`preview()` is the default. Fictional `+15550100xxx` numbers appear masked in the plan. Live CALL-E outbound is not required to run the tests.

## Cancellation

This skill does not place calls and does not create schedules. Cancel by withholding approval. If a host later dials, cancel through that host before `run_call`.
