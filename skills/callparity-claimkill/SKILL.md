---
name: callparity-claimkill
description: Compile the next CALL-E call as a leak-scored refute of a quoted freight claim, merge Party B quotes into a claim graph, and preview from fixtures with zero live calls.
license: MIT
---

# ClaimKill

CallParity spends the next CALL-E call to FALSIFY a claim. The planner writes call N+1 as the cheapest question that would flip an untested or supported node to contradicted. Questions that disclose party A's answer are dropped. We do not book appointments, cascade-until-yes, or one-shot-verify a person. We reconcile one freight fact.

`preview()` compiles that plan from committed fixtures and places zero calls. Live CALL-E outbound is not required to run the tests. `CONFIRMED` is an alias of `SUPPORTED`.

## When to use

Use this skill when two systems already disagree about one location or SKU, Party A has a quoted claim, and you need the cheapest Party B question that could flip that claim to contradicted without leaking Party A's answer.

## When not to use

Do not use this skill to book appointments, run cascade-until-yes outreach, survey a person, verify identity, or place a live call without explicit approval and stored consent.

## Workflow

1. Load a claim graph. Each node has `id`, `text`, `evidence.span.quote`, `observable_of`, and `status` in `SUPPORTED`, `UNTESTED`, `CONTRADICTED`, `UNREACHABLE`, `ABSTAIN`.
2. Score every `RefutationQuestion` with `leak_score`. Discard a question that discloses Party A's answer.
3. Keep observable questions Party B could have seen. On FR-1842, a driver question about whether dock 3 was empty stays. Any question that contains `warehouse said dock 3` is dropped.
4. Write call N+1 as the cheapest kept question that could flip an `UNTESTED` or `SUPPORTED` node to `CONTRADICTED`, within the spoken-time budget.
5. Run `scripts/claimkill.py preview --fixture fixtures/FR-1842.json`. Report the plan and stop. No call is placed.
6. After a host returns transcript quotes, run the merger. No falsifier leaves a node `UNTESTED`. Voicemail or a missing transcript becomes `UNREACHABLE`. Confidence below 0.45 becomes `ABSTAIN`.

Read `references/planner.md` for the leak-drop algorithm.
Read `references/schemas.md` for node, edge, and status fields.

## Demo ticket

FR-1842 is the only demo SKU. Before any call, the warehouse quote `pallet left dock 3` disagrees with the driver's report that dock 3 was empty. ClaimKill asks one refute question, not a survey. After merge, `dock` is `CONTRADICTED`, `arrival` is `SUPPORTED`, and `seal` is `UNTESTED`.

FR-1900 and FR-1888 are extra pytest fixtures for abstain and unreachable. Do not narrate them as a second product story.

## Preview

```bash
python3 scripts/claimkill.py preview --fixture fixtures/FR-1842.json
python3 scripts/claimkill.py merge --fixture fixtures/FR-1842.json
python3 -m pytest tests/test_claimkill.py -q
```

`calls_placed` is always `0` on this path. Phone numbers in the plan are masked.

## Safety

Read `references/safety.md` before compiling a plan that a host might later dial.

- Phone calls are real-world side effects.
- Require explicit user intent before any live call.
- Use E.164 numbers only. Mask them in summaries.
- Do not expose credentials.
- Do not create hidden recurring schedules or duplicate jobs for the same ticket.
- Cancel by withholding approval. This skill never places the call itself.
- Stay inside one operational freight fact. Refuse medical, legal, financial, or emergency content.

## Files

- `scripts/claimkill.py`: leak-drop planner, claim graph, merger, and `preview()`.
- `fixtures/FR-1842.json`, `fixtures/FR-1900.json`, `fixtures/FR-1888.json`.
- `tests/test_claimkill.py`: leak-drop and merger regressions.

Read `references/examples.md` for FR-1842 preview and merge output.
