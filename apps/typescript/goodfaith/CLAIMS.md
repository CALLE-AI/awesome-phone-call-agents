# CLAIMS — GoodFaith Honesty Ledger

> Every headline number here is RECOMPUTED from committed sources by `pnpm verify`
> (`scripts/verify-claims.ts`). If a claim below drifts from the fixtures, verify fails the build.

## Headline claims (recomputed from `data/fixtures/mri-72148.json` + `data/fair-prices.json`)

| Claim | Value | Recomputed by |
|---|---|---|
| Ranked winner (all-inclusive landed cost) | **$438** — Lone Star Open MRI | verify-claims `winner_landed` |
| Rollup `lowest_all_inclusive` | 438 | verify-claims `lowest_all_inclusive` |
| Winner vs fair self-pay ($500) | −12% (below fair) | normalize.test |
| Ranked clinics | 1 | verify-claims `ranked_count` |
| Non-comparable (flagged, not ranked) | 1 — Capitol Imaging Partners, $525 facility-only | verify-claims `non_comparable_count` |
| No-quote | 2 — Riverside (needs consult), Hill Country (voicemail) | verify-claims `no_quote_count` |

## The winner-flip (the differentiator)

Capitol's **$525 facility-only** quote is numerically *lower-scope* but excludes the radiologist
professional read, so it is flagged `NON_COMPARABLE` and never ranked. Lone Star's **$438 all-inclusive**
quote is the true landed-cost winner. A naive "cheapest raw number" ranker would surface the wrong answer;
GoodFaith enforces comparability first.

## Integration positioning (honest framing)

GoodFaith rests on **four load-bearing CALL-E surfaces**, not a point-count:
1. Multi-recipient parallel calls (`recipients[]`).
2. Per-recipient structured extraction (requested via `recipient_result_schema`; the current CALL-E API tier does not accept the JSON schemas, so fields are derived deterministically from the call transcript and summary). This extraction is heuristic and advisory.
3. `completion_confidence` gating (fail-closed at 0.6; this is CALL-E's model confidence used as a gate, not a correctness guarantee).
4. Evidence / transcript audit trail. A price is never ranked unless it traces to a real quoted sentence; that is a traceability guarantee, not a guarantee the number is correct.

Also implemented: idempotent webhook (`CALL-E-Event-Id`), live call-events stream, `metadata.rfq_id`
correlation, server-side-only credentials. Optional/stretch: Goals API path (`CALLE_GOAL_ID`).

We do **not** claim "deepest integration" or "10/10 points."

## Mode honesty (INVARIANT 5)

The default demo runs in **MOCK mode** — zero outbound calls, results from a recorded sample fixture,
badged MOCK on every result surface. A real call is placed only when `GOODFAITH_LIVE=1` AND `CALLE_API_KEY`
are both set. Mock is never presented as live.

## SDK source-lock note (build-time probe)

`@call-e/calle@0.7.0` real method shape confirmed against installed `dist/*.d.ts`:
`calls.createAndWait` (camelCase input: `resultSchema`/`recipientResultSchema`/`webhookUrl`),
`calls.get`, `calls.listEvents` (not `.events`), `goals.runAndWait` (per-run single `phone`).
The live adapter in `lib/calle.ts` maps the SDK's camelCase `Call` into GoodFaith's internal
snake_case `CallTask`. See `NOTES.md` for the full diff.
