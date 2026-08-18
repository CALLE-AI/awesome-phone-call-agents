# Caucus MCP tool results — schema reference

Every tool returns MCP `content` (one text block) plus, for the four
JSON-producing tools, `structuredContent` with the same data. Tool-domain
failures (unknown case, refused live mode, invalid amount) come back as a
result with `isError: true` and a plain-language message — protocol-level
JSON-RPC errors are reserved for malformed requests (unknown tool, arguments
failing the input schema).

Privacy invariants that hold for EVERY output below: phone numbers appear only
masked to last-4 (`"***0001"`); party-private intake data (reservation bounds,
notes) and the engine's private-bounds ZOPA estimate never appear at all.

## caucus_open_case

```json
{
  "case_id": "cs_<uuid>",
  "state": "created",
  "epoch": 0,
  "dispute": { "vertical": "...", "summary": "...", "amount_cents": 120000, "currency": "USD" },
  "parties": [
    { "id": "A", "label": "the landlord", "phone_masked": "***0001" },
    { "id": "B", "label": "the tenant",  "phone_masked": "***0002" }
  ],
  "policy": {
    "max_rounds": 8,
    "cooling_off_minutes": 0,
    "ttl_hours": 72,
    "call_window": { "start_hour": 9, "end_hour": 20, "timezone": "America/New_York" },
    "retry_delays_minutes": [15, 60]
  },
  "note": "No call was placed. ..."
}
```

`case_id` is the handle every other tool takes. Amounts are integer cents
everywhere in outputs; the open tool's INPUT takes `amount_dollars`.

## caucus_step_case

```json
{
  "case_id": "cs_...",
  "mode": "mock",
  "summary": "consent call to party A: completed",
  "noop": false,
  "state": "consent_pending_b",
  "epoch": 2,
  "terminal": false,
  "rounds_completed": 0,
  "call": { "purpose": "consent", "round": 0, "callee": "A", "phone_masked": "***0001" },
  "result": { "call_id": "mock_002_...", "outcome": "completed" },
  "ledger_entries_appended": 1
}
```

- `mode` — `"mock"` or `"live"`. Live only when `live: true` was passed AND
  `CALLE_API_KEY` is set on the server; otherwise a live request is refused
  with `isError: true` and no state change.
- `noop: true` — the step changed nothing (`epoch` unchanged). Causes: the
  case is terminal; the call went unanswered/failed; the structured result was
  unusable; an attestation read-back mismatched. Stop looping and inspect
  status. `summary` says which.
- `call` is `null` on tick steps (no dial); `result.outcome` is one of
  `completed | no_answer | declined | timed_out | failed | pending`.

## caucus_case_status

```json
{
  "case_id": "cs_...",
  "state": "settled",
  "terminal": true,
  "epoch": 11,
  "created_at": "2026-08-01T15:00:00.000Z",
  "updated_at": "2026-08-01T15:11:00.000Z",
  "dispute": { "vertical": "...", "summary": "...", "amount_cents": 120000, "currency": "USD" },
  "parties": [ { "id": "A", "label": "...", "phone_masked": "***0001" }, ... ],
  "rounds_used": 6,
  "max_rounds": 8,
  "rounds": [
    {
      "n": 1,
      "callee": "A",
      "outcome": "completed",
      "offer": {
        "kind": "open",
        "amount_cents": 54000,
        "conditions": ["tenant returns both mailbox keys"],
        "public_rationale": "The carpet replacement had a real cost.",
        "evidence": ["The most I can do right now is $540."]
      }
    }
  ],
  "assessment": {
    "impasse": false,
    "impasse_reason": null,
    "next_suggestion_cents": null,
    "curve": [ { "round": 1, "party": "A", "amount_cents": 54000 }, ... ]
  },
  "settlement": {
    "amount_cents": 72000,
    "conditions": ["tenant returns both mailbox keys"],
    "terms_digest": "<64-char sha256 hex>",
    "attestation_phrase": "821711",
    "attestations": [
      { "party": "A", "call_id": "...", "spoken_phrase": "821711", "verified": true, "at": "..." },
      { "party": "B", "call_id": "...", "spoken_phrase": "821711", "verified": true, "at": "..." }
    ]
  }
}
```

- `rounds[].offer` is `null` for rounds without a recorded offer;
  `offer.evidence` carries verbatim transcript quotes (provenance, never
  invented).
- `assessment` is computed from PUBLIC data only (the offers the parties made).
  `next_suggestion_cents` is the neutral midpoint the mediator may voice;
  `impasse_reason` is a human-readable string like
  `"stall: party A repeated their position ..."`.
- `settlement` is `null` until an offer is accepted. `attestation_phrase` is
  the six-digit read-back code; `spoken_phrase` is what the party actually
  said, verbatim — a false start like `"935 935006."` may verify (see the
  mediation-flow reference).

## caucus_verify_case

```json
{
  "case_id": "cs_...",
  "state": "settled",
  "verdict": "pass",
  "ledger": { "ok": true, "entries": 13, "head_hash": "<64-char hex>" },
  "settlement_present": true,
  "checks": [
    { "name": "ledger_chain", "ok": true, "detail": "all 13 entries hash-verified back to genesis" },
    { "name": "attestation_A", "ok": true, "detail": "spoken \"821711\" vs code \"821711\": match (call ...)" },
    { "name": "attestation_B", "ok": true, "detail": "..." },
    { "name": "attestation_calls_distinct", "ok": true, "detail": "each party attested on a separate call" }
  ]
}
```

- `verdict` is `"pass"` only when every check passes; otherwise `"fail"`.
- On an unsettled case, missing attestations are OK (`ok: true` with a
  "not yet recorded" detail) — absence is only a failure on a case that claims
  to be settled.
- A broken chain reports `ledger.broken_at_seq`. Treat any `"fail"` as: do not
  present this settlement to anyone; investigate the named check.

## caucus_case_memo

`content[0].text` is the full markdown memorandum;
`structuredContent = { case_id, state, markdown }`.

The memo always contains: the non-binding notice (verbatim, prominent),
parties with masked phones, the dispute, a round-by-round table with amounts,
conditions and verbatim evidence quotes, the settlement terms with the SHA-256
terms digest and attestation records (or an explicit "no settlement was
reached"), and the ledger entry count and head hash. It is safe by
construction to give the identical memo to both parties.

## Input validation errors (JSON-RPC level)

Arguments are validated before any tool logic runs. Failures return JSON-RPC
error `-32602` (invalid params) with `data.issues = [{path, message}, ...]`,
e.g. a phone not in E.164 form reports `path: "party_a.phone"`. Unknown tools
return `-32602` with `data.knownTools`. Unknown methods return `-32601`.
