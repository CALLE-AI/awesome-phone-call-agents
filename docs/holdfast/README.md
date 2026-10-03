# HoldFast

**Every answer needs something to stand on.**

HoldFast is a Python Agent Skill that turns an authorized phone-work task into
one CALL-E call and an evidence receipt. It previews the destination and scope,
requires explicit confirmation, follows the provider's call status, and checks
returned structured fields against callee-side transcript evidence.

The included walkthrough follows Sam's repair shop: an order is holding up a
service bay. The saved answer says the part shipped, arrival is estimated for
Tuesday, nothing is backordered, and the tracking number is ZX-9081. The receipt
supports the first three answers and withholds the tracking number because the
recording never said it.

Sam, the business, order, number and timeline are **controlled fictional data**.
The walkthrough places no call. The result packet is actual output from running
HoldFast on that fixture; the HTML receipt is a static presentation of it.

## Try the no-call demonstration

Clone the contribution's branch or download its test build. From the repository
root, with Python 3.10 or later:

```bash
python3 skills/holdfast/scripts/run_task.py \
  --task skills/holdfast/tests/fixtures/judge-parts-task.json \
  --inspect-result skills/holdfast/tests/fixtures/judge-parts-result.json
```

Expected result: `PARTIALLY VERIFIED`; three `PROVEN` fields and the unsupported
tracking number `NOT PROVEN`. `PROVEN` means transcript-supported, not guaranteed
real-world truth. Tuesday remains an arrival estimate.

Open [the static evidence receipt](../../skills/holdfast/assets/judge-evidence-receipt.html)
in a browser. This walkthrough requires no CALL-E account, credentials, network,
payment or phone recipient. Never use the fixture's fictional number for a live call.

## Run the offline checks

```bash
python3 -m unittest \
  skills.holdfast.scripts.test_run_task \
  skills.holdfast.tests.test_holdfast \
  skills.holdfast.tests.test_verifier_redteam \
  skills.holdfast.tests.test_cli_envelopes
python3 scripts/validate_repository.py
```

All provider interactions in these tests are mocked. The tests cover consent,
duplicate-start prevention, resume binding, masking, provider completion
envelopes, callee-only evidence, field anchors, units, dates and contradictions.

## Optional authorized live use

Install and authenticate the official [CALL-E CLI](https://github.com/CALLE-AI/call-e-integrations)
and prepare your own task using [the skill's intake contract](../../skills/holdfast/SKILL.md).
The destination and authorization scope must come from the user. First preview:

```bash
python3 skills/holdfast/scripts/run_task.py --task task.json
```

Only after reviewing that plan, opt into one real call:

```bash
python3 skills/holdfast/scripts/run_task.py --task task.json --run
```

The CLI asks for confirmation before dialing. CALL-E credit availability and
pricing apply. There is no CLI cancel command or hard duration limit. An ambiguous
start is never automatically redialed; inspect recovery and use `--resume` for a
known in-flight task. Never delete the ledger to bypass this boundary.

Each run saves its masked plan, start acknowledgement, timestamped status samples,
final result, field verification and `result-packet.txt`. CLI 0.5.1's documented
`result.structuredContent` and latest `status_result.structuredContent` envelopes
are recognized; arbitrary nested business status fields cannot prove completion.

The current CALL-E CLI exposes no structured-result schema parameter. If a call
returns only a transcript, the receipt explicitly reports that no structured
fields are available. It does not fabricate them. The verifier is an experimental
rule-based support check, not a model or a factual guarantee; unsupported,
contradictory or inconclusive answers remain visible with their limitations.

## Evidence and limits

[Historical CALL-E artifact excerpts](evidence/historical-calle.json) document two
completed calls to public NWS automated weather recordings. They contain provider
run IDs, transport completion, durations and short source excerpts. They are
historical integration evidence, not the Sam scenario or a new execution of the
current runner. Neither returned `structured_result`.

Those calls do not establish provider-side DTMF events, hold queues, human pickup,
reviewed-route reuse or a current end-to-end structured-result chain. The dated NWS
maps therefore remain unreviewed reference material. An additional live run was
not performed because current account credit was exhausted; no new live success
is claimed. The no-call walkthrough remains freely reproducible for judging.

The contribution is an experimental desktop Agent Skill, not a hosted production
service. Repository contribution: [PR #462](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/462).
