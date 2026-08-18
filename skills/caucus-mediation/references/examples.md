# Examples

All numbers here are reserved fictional numbers (+1555…). Every example below runs in
mock mode — no credentials, no network, no calls — and is deterministic, so the outputs
shown are the outputs you will get.

## A complete mediation over MCP (mock mode)

The smoke-path mock persona consents, opens at a flat $100, accepts whatever is relayed,
and echoes attestation codes — so a full case settles in six steps and every tool can be
exercised end to end before any live configuration exists.

1. **Open the case** (never dials):

```json
{ "name": "caucus_open_case", "arguments": {
  "vertical": "security-deposit",
  "summary": "Disputed deductions from a residential security deposit after move-out.",
  "amount_dollars": 1200,
  "party_a": { "label": "the landlord", "phone": "+15550000001" },
  "party_b": { "label": "the tenant",  "phone": "+15550000002" }
} }
```

Returns a `case_id` (`cs_…`). State is `created`; the first step will move it through the
clock tick to the consent calls.

2. **Step until settled** — call `caucus_step_case` with `{ "case_id": "cs_…" }` repeatedly.
The six steps report, in order:

```text
consent call to party A: completed      -> consent_pending_b
consent call to party B: completed      -> rounds_active
shuttle call to party A: completed      -> rounds_active   (open offer, $100)
shuttle call to party B: completed      -> attestation_pending_a   (accept $100)
attestation call to party A: completed  -> attestation_pending_b
attestation call to party B: completed  -> settled
```

A step that reports `noop: true` changed nothing (in live mode that means a failed call
or an unusable extraction) — in live mode, never re-step blindly: read the status first,
then decide whether a re-dial is warranted.

3. **Check status** — `caucus_case_status` (argument `{ "case_id": "cs_…" }`) returns
masked, share-safe state — the shapes below are the ones pinned by `test/mcp.test.ts`:

```jsonc
{ "state": "settled", "terminal": true,
  "rounds": [ /* one entry per shuttle round, evidence quotes included */ ],
  "settlement": {
    "amount_cents": 10000,
    "terms_digest": "…64 hex chars…",
    "attestation_phrase": "…6 digits…",
    "attestations": [
      { "party": "A", "call_id": "…", "verified": true },
      { "party": "B", "call_id": "…", "verified": true }
    ]
  } }
```

4. **Verify** — `caucus_verify_case` recomputes the hash chain and re-checks both
read-backs against the digest-derived code, including a named check that the two
attestations came from two distinct calls:

```jsonc
{ "state": "settled", "verdict": "pass",
  "ledger": { "ok": true, "entries": 11, "head_hash": "…" },
  "checks": [
    { "name": "ledger_chain", "ok": true, "detail": "…" },
    { "name": "attestation_A", "ok": true, "detail": "…" },
    { "name": "attestation_B", "ok": true, "detail": "…" },
    { "name": "attestation_calls_distinct", "ok": true,
      "detail": "each party attested on a separate call" }
  ] }
```

5. **Memorandum** — `caucus_case_memo` returns `{ "markdown": … }` — the non-binding memorandum:
masked phones, the round table with verbatim evidence quotes, settlement terms, the
SHA-256 terms digest, and both attestation records.

## The same flow on the CLI

```sh
npx tsx src/cli.ts open --db demo-run.db --vertical security-deposit \
  --summary "Disputed deductions from a residential security deposit after move-out." \
  --amount 1200 \
  --party-a "the landlord:+15550000001" --party-b "the tenant:+15550000002"
# prints: cs_<uuid>

npx tsx src/cli.ts run cs_<uuid> --db demo-run.db --step     # repeat until "case is settled"
npx tsx src/cli.ts verify cs_<uuid> --db demo-run.db         # verify: PASS, exit 0
npx tsx src/cli.ts memo cs_<uuid> --db demo-run.db --out memo.md
```

## A realistic negotiation, still with zero calls

The rehearsal runner scripts adversarial personas instead of the smoke path: the
landlord climbs $400 → $500 → $600 → $700 while the tenant concedes from $1,200 and
accepts at $700, and the settlement carries the standing offer's "tenant returns both
mailbox keys" condition even though the accepting party never restated it.

```sh
npx tsx scripts/run-live-case.ts --rehearse --yes
```

Ends with the ledger chain verified, both attestations verified, and a memorandum
written — the exact artifacts a live case produces, minus the telephone.

## Going live (only after the above works)

Live mode is doubly opt-in (`--live` plus `CALLE_API_KEY`) and steps one call at a
time — the interactive runner (`scripts/run-live-case.ts --live --phone-a … --phone-b …`)
waits for an explicit keypress before every dial because a human must be ready to
answer. Read `safety.md` first: consent calls always come before any substantive call,
and both phones must belong to people who have agreed to take part.
