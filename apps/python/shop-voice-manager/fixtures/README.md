# Demo fixtures — Voice Shop Manager

Fake CALL-E call results for one fictional shop across one week. These let the
app, the ingest layer, the weekly summary, and the tests be built and run
**without CALL-E credentials and without placing a single phone call**.

Refs #28.

```bash
python3 fixtures/validate_fixtures.py
```

No network, no credentials, exits non-zero on any problem.

## What is here

| Path | Contents |
| --- | --- |
| `shop-profile.json` | The fictional shop: Ada Corner Shop, Lagos. Products, reference costs, consent record. |
| `calls/` | 14 completed calls — 7 days x (morning inventory + evening sales). |
| `edge-cases/` | 5 sad-path results the ingest layer must handle without corrupting the ledger. |
| `expected/weekly-summary.json` | Fixture-level reconciliation target. Totals the call fixtures must add up to. |
| `expected/summary-turnover.json` | Golden `summarize.py` output, turnover method (the default). |
| `expected/summary-top-sellers.json` | Golden `summarize.py` output, the plan's original method. See [Two definitions](#two-definitions-of-slow-moving). |
| `validate_fixtures.py` | Guards all of the above. See [Validation](#validation). |

## The week

Seven days, **2026-08-10 (Mon) to 2026-08-16 (Sun)**, for `demo-lagos-corner-shop`.

The data is not random. It encodes a deliberate story so the weekly summary has
something real to find:

| Product | Behaviour across the week | Why |
| --- | --- | --- |
| **Rice** | Sells steadily, restocked twice | Normal healthy stock turn |
| **Indomie** | Sells fastest, restocked twice, still ends low | Drives the "running low" alert |
| **Sugar** | Slow steady decline, one small restock, ends low | Second "running low" signal |
| **Cooking oil** | Barely moves, never a top seller | Dead stock — capital signal |
| **Milo** | Does not move at all | Dead stock — the clearest capital signal |

Weekly totals, which the summary must reproduce exactly:

```
revenue    NGN 425,000
restocking NGN 310,000
gross      NGN 115,000
running low          Indomie, Sugar
slow-moving capital  NGN  87,000   (Cooking oil 14 x 3,000 + Milo 9 x 5,000)
```

Those first three figures are **the same numbers spoken in
`docs/projects/voice-shop-manager/DEMO_SCRIPT.md`**. The demo video line is
reproducible from these fixtures rather than invented for the recording.

## Edge cases

The skill's `references/examples.md` defines a "Bad outcomes" table. Each row has
a fixture, because the ingest layer has to do the right thing for all of them:

| Fixture | Status | What ingest must do |
| --- | --- | --- |
| `no-answer.json` | `no_answer` | Record the attempt, write nothing to the ledger, do not retry same day without approval |
| `voicemail.json` | `voicemail` | Mark incomplete, flag for manual reconciliation |
| `consent-refused.json` | `completed`, `task_completed: false` | **Stop calling this shop.** Do not retry |
| `low-confidence.json` | `completed`, confidence `0.41` | Do **not** write to the ledger — flag for human review |
| `partial-inventory.json` | `completed`, confidence `0.72` | Accept the two products captured; do not zero out the ones never discussed |

`low-confidence.json` is the one most likely to be handled wrongly. It reports a
plausible revenue figure and `task_completed: true`. Only the confidence score
says it is unreliable. **Ingest must gate on confidence, not on
`task_completed` alone.**

## Validation

`validate_fixtures.py` is what stops these files from quietly drifting. It checks:

1. Every fixture parses.
2. Every `structured_result` validates against the **committed skill schemas** at
   `skills/shop-voice-checkin/references/result-schema-{inventory,sales}.json`.
3. No phone number outside the fictional allowlist appears anywhere — including
   inside transcript text.
4. Envelope invariants: required fields, known statuses, confidence in `[0, 1]`.
5. Idempotency keys are unique and match `shopvoice-{shop_id}-{type}-{date}`.
6. **Every real conversation contains the AI disclosure line the skill requires.**
   This one caught a genuine omission while the fixtures were being written.
7. The weekly totals implied by `calls/` reconcile **exactly** with
   `expected/weekly-summary.json` — revenue, spend, gross, call count,
   final-day running-low list, and every slow-moving capital figure.

Check 7 is the important one. It means `expected/weekly-summary.json` can be
trusted as the assertion target for `summarize.py` (#18) and the integration
test (#26): if anyone edits a call fixture without updating the summary, the
validator fails.

It prefers `jsonschema` when installed and falls back to a small built-in
checker otherwise, so it runs in a bare environment. Both paths are equivalent
for these schemas.

## Two definitions of "slow moving"

`PROJECT_PLAN.md` defines slow-moving stock as "items not mentioned as sold in
7 days" — that is, never named in `top_sellers`. **That definition is wrong, and
this fixture data is what proves it.**

| Product | Start | End | Restocked | Consumed | Weekly turnover |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rice | 12 | 7 | 4 | 9 | 105% |
| Indomie | 15 | 4 | 10 | 21 | 237% |
| Sugar | 6 | 2 | 1 | 5 | 125% |
| **Cooking oil** | 20 | 14 | 5 | **11** | **63%** |
| **Milo** | 9 | 9 | 1 | **1** | **11%** |

Cooking oil moves 11 units a week — more than rice. It never appears in
`top_sellers` only because that field ranks by revenue and oil is cheap. Under
the plan's definition it is flagged as &#8358;42,000 of dead capital, which is
simply false.

`summarize.py` therefore defaults to a **turnover** method —
`consumed / average stock held`, where `consumed = start - end + restocked` —
and flags anything below 25%. On this data only Milo qualifies, and the capital
figure is &#8358;45,000 rather than &#8358;87,000.

Both are implemented behind `--slow-moving-method` so the team can compare them
on real numbers. **Pick one before the demo**, update `PROJECT_PLAN.md`, and
delete the other golden file.

## Schema note — read before writing ingest code

Use the **committed schemas** as the source of truth, not the tables in
`PROJECT_PLAN.md`. The plan is stale: it shows `estimated_revenue_ngn` and
`last_purchase_price_ngn`, while the committed schemas correctly use
currency-neutral `estimated_revenue` and `last_purchase_price` plus a separate
`currency` field. The currency-neutral names are right — NGN-suffixed keys would
fork the schema for the India variant (now shipped as #21 / AR5).

## Envelope note — reconcile against a real response

The `structured_result` objects are authoritative: they are validated against the
committed schemas on every run.

The **surrounding envelope** — `call_id`, `metadata`, `recipients[].attempts[]`,
`duration_seconds`, `started_at` — is modelled on the response documented in the
CALL-E README, extended with the fields this app needs. It has **not** yet been
reconciled against a real API response, because CALL-E authentication (#1) is
still open.

Once the first live call lands (#10), diff a real response against
`calls/2026-08-10-inventory.json` and correct these fixtures. Until then, ingest
code should read `structured_result`, `status`, and `completion_confidence` —
the three fields documented in the CALL-E README — and treat everything else as
provisional.

## Regenerating

The fixtures are committed as plain reviewable JSON on purpose; edit them
directly. If you change a call fixture, update `expected/weekly-summary.json` to
match, then run the validator — it will tell you if the two disagree.

## Safety

Every phone number here is the reserved fictional `+2348000000000`. Never commit
a real number, a live request file, an API key, or a transcript from a real call.
See `skills/shop-voice-checkin/references/safety.md`.
