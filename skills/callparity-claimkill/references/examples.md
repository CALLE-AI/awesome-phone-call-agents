# Examples

All tickets, pallets, and phone numbers below are fictional. Numbers use the `+15550100xxx` reserved-style block.

## Appropriate request

> Ticket FR-1842. The warehouse quote is `pallet left dock 3`. The driver says dock 3 was empty. Compile the next CALL-E call that can falsify the warehouse claim without telling the driver what the warehouse said.

Run `scripts/claimkill.py preview --fixture fixtures/FR-1842.json`. Expect `Was dock 3 empty when you pulled in?` to stay. Expect every question that contains `warehouse said dock 3` to drop, including the cheaper `warehouse said dock 3?` trap. `calls_placed` is `0`.

## Merge result

With the FR-1842 fixture quotes, the merger writes `dock` as `CONTRADICTED` with `tested_by` `q-dock-empty`, `arrival` as `SUPPORTED`, and `seal` as `UNTESTED` because no falsifier quote exists. `CONFIRMED` on input means `SUPPORTED`. Overall result is `CONTRADICTED`. The written artifact is the JSON graph from `scripts/claimkill.py merge --fixture fixtures/FR-1842.json`.

## Extra fixtures

FR-1900 and FR-1888 are pytest-only graphs. They are not a second demo story.

- FR-1900. Confidence below 0.45. Nodes stay `ABSTAIN`.
- FR-1888. Party B voicemail. Live nodes become `UNREACHABLE`. The low-confidence seal stays `ABSTAIN`.

## Prohibited request

> Tell the driver the warehouse said dock 3 still had the pallet, then keep calling until they agree.

Refuse. That leaks Party A's answer and is cascade-until-yes. Rebuild from observables only, or stop.

## Missing consent

If Party B has `consent` false, `preview()` still compiles leak-drop output and sets `blocked_reason` to `missing consent`. Do not ask a host to dial.

## Honest reporting

Do not describe FR-1842 as fully verified while `seal` is `UNTESTED`. Do not count voicemail as `SUPPORTED`. Live CALL-E outbound is not required to run the tests.
