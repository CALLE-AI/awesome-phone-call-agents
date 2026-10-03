# Voice Shop Manager (Python demo)

**Your business manager, on the phone** — demo build for the CALL-E hackathon.

Voice-first check-ins for informal retailers: morning inventory and evening sales captured by CALL-E, structured into JSON, summarized into weekly business insights.

> **Demo mode:** This app runs **without** a live phone call or API key by default. Fixtures simulate completed calls so judges and collaborators can run the flow locally.

## Setup

Python 3.11 or newer. The app itself needs nothing installed: `store.py`,
`ingest.py`, `summarize.py` and the web server import only the standard
library, so the demo and the console run on a clean checkout.

Two things are optional, and only if you want them:

```bash
cd apps/python/shop-voice-manager
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate

pip install -r requirements-dev.txt  # pytest + jsonschema, to run the tests
pip install "calle-ai>=0.1.0"        # the CALL-E SDK, only to place real calls
```

`calle-ai` is declared as the `live` extra in `pyproject.toml`. It is not a
dependency: `live_call.py` imports it lazily, so `--help`, the demo, the tests
and the console all work without it. You only need it at the moment a call is
actually placed.

Credentials come from the environment, never from a committed file.

## Run the console

```bash
cd apps/python/shop-voice-manager
export CALLE_API_KEY=calle_live_...     # your key; omit to browse read only
venv/bin/python web/server.py           # http://127.0.0.1:8765
```

Use the interpreter that has `calle-ai`, otherwise the call fails at dial time
with "The CALL-E SDK is not installed". Startup prints which mode it is in:

```text
Shop Check-In console on http://127.0.0.1:8765
  ledger  .../shop-voice-manager/shop.db
  mode    live
```

`mode live` means it can dial. `read only` means `CALLE_API_KEY` is not set in
that shell, and `export` only affects the terminal you ran it in. Add
`SHOPVOICE_DEMO=1` to replay a stored call instead of dialling, or
`SHOPVOICE_RELOAD=1` while editing so the server restarts itself.

## Quick start (demo — no CALL-E credits)

```bash
cd apps/python/shop-voice-manager
python client.py --request example_request.json
python client.py --request example_request_sales.json
python client.py --request example_request.json --weekly-summary
python client.py --request example_request_inr.json   # India / INR preview
```

Expected: masked preview plan + fixture structured result. No network.

`--weekly-summary` is **computed, not canned**. The fixture call results are
ingested into a real SQLite ledger and `summarize.py` derives every figure from
it — change a fixture and the numbers change. Add `--slow-moving-method
top-sellers` to compare the two ways of identifying dead stock.

## Live calls (opt-in — R5, implemented)

A real call needs **both** flags, plus a key. Any one missing exits `2` without
building a client:

```bash
export CALLE_API_KEY=...                    # never commit this
python client.py --request my-live-request.json \
    --execute --confirm-recipient-opt-in \
    --db shop.db                            # optional: ingest the result
```

Refusals, all before anything dials:

| Situation | Result |
| --- | --- |
| `--execute` without `--confirm-recipient-opt-in` | exit 2 |
| `recipient_consented` not `true` in the request | exit 2 |
| `CALLE_API_KEY` unset | exit 2 |
| `CALLE_BASE_URL` not `https://api.heycall-e.com` | exit 1 |
| `--live` (the old spelling) | exit 2, tells you the new flags |

**One call per shop per type per day.** The idempotency key is
`shopvoice-{shop_id}-{call_type}-{date}` and a checkpoint under `.call-state/`
records the call id the moment CALL-E returns one — so a crash mid-call, or a
rerun, **polls the existing call instead of placing a second**. Checkpoints
store a masked phone and a hash of the key, never the key or the full number.

The result is handed to the same `ingest.ingest_call` the fixtures go through,
so a live call faces the identical confidence gate. See
`skills/shop-voice-checkin/references/safety.md`.

## Web console

A browser console over the same ledger, for the person who runs the calls
rather than the person who wrote them:

- **Customers** — every shop, with how many calls landed and how many did not
- **Shop** — details, usual products, and the full call history
- **Call** — status, captured stock, evidence, transcript
- **Place check-in call** — a dialog on the shop: pick the products, confirm the
  cost, then watch the phases as it rings

See [Run the console](#run-the-console) above for how to start it. It is
standard library only, so it adds no dependency and `dependencies = []` still
holds.

Nothing about a shop is hardcoded. Shops, numbers, products, units and currency
live in the ledger and are created through the UI. The lists it offers come
from the environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CALLE_API_KEY` | unset | Required to place a call. Server side only, never sent to the browser |
| `SHOPVOICE_DB` | `./shop.db` | Ledger path |
| `SHOPVOICE_HOST` | `127.0.0.1` | Bind address |
| `SHOPVOICE_PORT` | `8765` | Port |
| `SHOPVOICE_DEMO` | unset | `1` replays a stored call instead of dialling |
| `SHOPVOICE_RELOAD` | unset | `1` restarts the server when a source file changes |
| `SHOPVOICE_REGIONS` | `NG,GH,KE,ZA,US,…` | Countries offered |
| `SHOPVOICE_CURRENCIES` | `NGN,GHS,KES,…` | Currencies offered |
| `SHOPVOICE_LOCALES` / `SHOPVOICE_STYLES` | English, Pidgin | What the owner hears |
| `SHOPVOICE_UNITS` | bags, kegs, kg, … | Unit suggestions; the field is free text |

Pressing **Place check-in call** with a key set places a real call and spends a
credit, exactly like `--execute`. The consent record and the product list both
have to be in place first.

`http.server` is right for one operator on localhost. Non-loopback binds are
refused unless `SHOPVOICE_ALLOW_REMOTE=1` and `SHOPVOICE_REMOTE_TOKEN` are set;
mutating API routes also reject cross-origin controls. Do not bind `0.0.0.0`
on a shared network without that token.

Live procurement after the first check-in is **advisory**: the console plans
reorder / vendor / status legs but does not dial them until
`POST /api/checkins/approve` with explicit `consent` (and
`vendor_contact_authorized` for vendor legs). `SHOPVOICE_DEMO=1` may
auto-rehearse the chain with fixtures.

## Calls placed

`.call-state/` is local and never committed: each checkpoint carries a masked
phone number and a hash derived from the API key. The call ids themselves are
evidence worth keeping, so they are published separately.

```bash
python3 calls_placed.py            # print
python3 calls_placed.py --write    # update CALLS.md, then commit it
```

Only calls CALL-E actually created are listed. A checkpoint that never got a
call id means no call was placed, and saying otherwise would overstate what
this project has done.

## Side effects

| Mode | Network | Phone call | Credits |
| --- | --- | --- | --- |
| Default / `--fixture` / `--weekly-summary` | No | No | 0 |
| `pytest` | No | No | 0 |
| `--execute --confirm-recipient-opt-in` | Yes | **Yes** | 1 per call |
| `web/server.py` browsing | No | No | 0 |
| `web/server.py` with `SHOPVOICE_DEMO=1` | No | No | 0 |
| Console **Start check-in** with a key set | Yes | **Yes** | 1 per call |

## Files

| File | Purpose |
| --- | --- |
| `example_request.json` | Morning inventory demo request (masked phone) |
| `example_request_sales.json` | Evening sales demo request |
| `fixtures/` | Fictional transcripts and structured results, plus a full week of calls, edge cases, and golden summaries |
| `client.py` | Demo runner |
| `summarize.py` | Weekly business insights, computed from the ledger (AR2) |
| `store.py` | SQLite ledger — schema, migrations, and the four write paths (R4) |
| `ingest.py` | Turns a CALL-E result into ledger rows; confidence-gated, idempotent (R6) |
| `demo_ledger.py` | Feeds the fixtures through `ingest.py` → `store.py`. Only the input is fake — the write path is the production one |
| `live_call.py` | The live CALL-E path (R5): trusted-host check, consent check, crash-safe checkpoints, result normalisation |
| `payments/` | Phase 3 fake payment adapter — preview by default, no bank network |
| `SCHEMA.md` | The ledger contract both sides build against |
| `web/server.py` | HTTP API and static host for the console. Standard library only; imports the modules above without modifying them |
| `web/static/` | The console itself: customers, call history, call detail, live status |
| `tests/` | Pytest suite. No credentials, no network, no calls |

## Phase 2 — procurement (demo)

Low stock → reorder offer → vendor capture → vendor call → owner status
callback, end to end, no network:

```bash
pytest tests/test_store_procurement.py -q
```

The chain in one call: `python client.py --request example_request.json
--fixture reorder-offer-result.json` previews the reorder-offer call the same
way inventory/sales do. See `fixtures/procurement/` for the full envelope
fixtures (schema-checked and disclosure-checked by `validate_fixtures.py`) that
drive the integration test
`test_full_procurement_chain_reflects_in_the_final_order`.

New-shop onboarding follows the same pattern — `call_type=onboarding` writes
straight to `shops`/`products`; a returning owner (same phone) updates the
existing row instead of creating a second shop.

## Phase 3 — vendor payouts (demo)

After a confirmed order has an amount, link an offline `payee_ref`, create a
`payment_intent`, approve from owner consent, then submit through the **fake**
adapter (still no bank API):

```bash
# See tests/test_payments.py for the full lifecycle.
pytest tests/test_payments.py -q
```

Live bank rails (Paystack/Flutterwave/etc.) are not wired; the adapter interface
is the seam. Dual flags for fake execute: `SubmitFlags(execute=True,
confirm_owner_payment=True)`.

## Tests

```bash
pip install -r requirements-dev.txt
pytest tests -q
python fixtures/validate_fixtures.py
```

Individual suites:

```bash
pytest tests/test_live_call.py -q   # the live path, fully stubbed
pytest tests/test_store_ingest.py -q
pytest tests/test_summarize.py -q
pytest tests/test_store_procurement.py -q  # Phase 2 procurement + onboarding
pytest tests/test_payments.py -q    # Phase 3 payouts
pytest tests/test_no_live_calls.py -q
```

`tests/test_live_call.py` covers R5 without the SDK installed and without a
credential — it drives `execute_live` with a stub client that records every
`create`, so "did we place two calls?" is an assertion rather than a hope. Run
it after any change to `live_call.py`; it is the only thing standing between a
refactor and a duplicate call. To see one test's reasoning:

```bash
pytest tests/test_live_call.py::test_rerun_after_a_crash_polls_instead_of_calling_again -v
```

`tests/test_no_live_calls.py` scans every test file for anything that could
dial. If you legitimately need to name the CALL-E host in a test — the
allowlist tests do — mark that line `# allow-host-literal` so the exception
stays visible.

Or run everything the pre-push hook runs, from the repository root:

```bash
./check.sh                          # validation + fixtures + tests
```

None of it places a phone call or needs credentials.

## Cancellation

Recurring check-ins are owned by the host scheduler, not this app. To stop them,
see [`scheduling.md`](../../../skills/shop-voice-checkin/references/scheduling.md#cancellation).
Clearing `recipient_consented` alone does **not** stop calls — the scheduler
never reads it.

## Skill

Agent workflow: [`skills/shop-voice-checkin/`](../../skills/shop-voice-checkin/)

## Project plan

[`docs/projects/voice-shop-manager/PROJECT_PLAN.md`](../../../docs/projects/voice-shop-manager/PROJECT_PLAN.md)
