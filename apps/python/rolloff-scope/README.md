# RolloffScope

RolloffScope is a dry-run-first CALL-E app for one concrete phone task: compare roll-off-dumpster bids on the same scope without mistaking a low base rental for the lowest all-in cost.

The app captures base rental, delivery and pickup, included days, included tonnage, overage per ton, fuel and environmental charges, permit terms, prohibited materials, tax, availability, validity, assumptions, contradictions, and field-level evidence. It refuses to rank a bid when any material term is missing, unknown, contradictory, or unsupported by evidence.

RolloffScope never haggles, books, orders, reserves, accepts a bid, authorizes work, or promises payment.

## Safe local demo

Requirements: Python 3.11 or newer. Runtime dependencies: none outside the Python standard library.

From this directory, preview the fictional four-vendor task:

```powershell
python -m rolloffscope fixtures/request.json
```

Preview is the default. It performs no network operation. It prints a masked call plan, the structured-result contract, a stable idempotency key, and an approval token bound to the complete request.

Normalize the deterministic CALL-E-shaped result:

```powershell
python -m rolloffscope fixtures/request.json --result fixtures/completed-call.json
```

The locked scope is a fictional 20-cubic-yard roll-off dumpster for non-hazardous household cleanout waste, seven rental days, an estimated 2.5 tons, private-driveway placement, and delivery from September 15 through 17, 2026.

The expected output is `fixtures/expected-normalized.json`:

- the complete bid totals USD 615.00 and is the only ranked bid;
- the USD 350 low-base bid is excluded because overage and tax were omitted;
- the contradictory environmental-fee bid is excluded;
- the voicemail result is unresolved;
- every decision remains human-owned.

Run the offline suite:

```powershell
python -m unittest discover -s tests -v
```

## How the USD 615.00 total is computed

The complete fixture has:

- USD 475 base rental;
- delivery and pickup included;
- two included tons;
- USD 80 per additional ton, with 0.5 expected additional tons, producing USD 40;
- USD 25 fuel fee;
- USD 15 environmental fee;
- no permit fee for the stated private-driveway placement;
- USD 60 tax.

RolloffScope adds only components explicitly marked additional. Included or absent fees are not added. A fee marked additional needs a positive amount. A missing status, amount, or evidence binding makes the bid incomplete.

## Evidence and comparability gate

Evidence records contain a statement plus the exact result fields it supports. Every present material fact must appear in at least one evidence record. RolloffScope also requires:

- `outcome: quoted` and a completed recipient result;
- an exact scope match and requested currency;
- confirmed availability and a delivery value;
- at least the requested rental days;
- included tonnage and a known overage rule;
- known delivery, pickup, fuel, environmental, permit, prohibited-material, and tax terms;
- a quote-validity value;
- an explicit assumptions list;
- no reported contradiction.

Unknown or malformed results remain unranked. If the provider returns a different recipient count than the request, every ranking is disabled because position-based vendor mapping is no longer trustworthy.

## CALL-E integration

The app follows CALL-E's official Developer API example:

- `POST https://api.heycall-e.com/v1/calls` creates one multi-recipient task;
- top-level request fields are `task`, `recipients`, `result_schema`, `recipient_result_schema`, and `metadata`;
- recipients use `phones`, `region`, and `locale`;
- structured-result schemas use the documented CALL-E keyword subset and enforce numeric and collection bounds after receipt;
- `Idempotency-Key` is stable for the complete request;
- `GET /v1/calls/{call_id}` reads the already-accepted call until terminal;
- the create operation is never replayed automatically after an uncertain result.

## Live-call boundary

The REST adapter was exercised through an injected in-process fake API. A separate authorized organizer-hotline call completed on September 9, 2026 using the official CALL-E CLI. Importing that saved CLI result is supported below; it does not establish live REST schema acceptance.

A real call requires all of these at the same time:

1. the request sets `live_authorized` to `true`;
2. its timezone-aware `call_window` includes the current time;
3. every number is E.164, has a purpose-bound authorization reference, and appears in server-controlled `ROLLOFFSCOPE_ALLOWED_PHONES`;
4. the command includes `--live --confirm <current-preview-token>`;
5. `CALLE_API_KEY` exists only in the process environment.

Credential-bearing requests are pinned to `https://api.heycall-e.com`. The client sends one POST, retains the returned call ID, and polls that ID with GET. An uncertain POST or timeout is a reconciliation state and never triggers a second create.

The app writes only masked preview data or normalized result data. It does not write API keys, full phone numbers, or transcripts. The fixtures contain only fictional reserved 555 numbers and synthetic statements.

Once CALL-E accepts a task, this prototype has no cancellation guarantee. Do not use the live path without separate authorization for the exact recipients, call window, and call content.

## Official CLI runtime workflow

Use the [official CALL-E CLI installation and authentication instructions](https://github.com/CALLE-AI/call-e-integrations/tree/main/packages/cli). The CLI initiates the authorized call; the Python app imports its completed status. The Python REST adapter is a separate, still-unverified live route.

A live demonstration needs an authenticated account with verified usable free capacity, an individually authorized recipient and task, and an agreed call window. Neither the fictional bundled phone nor the previously completed hotline test authorizes another call. The command below initiates a real phone call and must not be executed merely to run the offline demo.

```text
calle call start --to-phone AUTHORIZED_E164_NUMBER --goal "AGREED_CALL_TASK"
```

Retain the returned run ID. If initiation is uncertain, stop and reconcile the existing operation using the official recovery documentation; do not repeat initiation. For the newly authorized run only, obtain the official status JSON:

```text
calle call status --run-id RETURNED_RUN_ID
```

Save the complete terminal status JSON privately as UTF-8 without a byte-order mark. Use the output of `call status`, not `call start` or `call run`: their output envelopes differ. The importer requires the `get_call_run` envelope under `result.structuredContent`. Then, from the RolloffScope directory:

```text
python -m rolloffscope request.json --mcp-result saved-cli-status.json --expected-run-id RETURNED_RUN_ID
```

The import requires successful CLI output containing terminal metadata for that exact run. It performs no networking and discards free-text summaries, transcripts and quote-like extraction. It does not infer a price, map recipients or rank a vendor. The demonstrated hotline call completed without usable quote evidence. Synthetic quote normalization and real completion-metadata import must be shown separately and labeled accurately.

The bundled examples remain offline. Use the existing-result commands below to inspect them without contacting the provider.

## Import an existing CLI result (offline)

The official CLI returns `get_call_run` completion metadata with a different shape from the Developer API quote response. Save its JSON output privately, then import it with the run ID already known to the operator:

```powershell
python -m rolloffscope request.json --mcp-result saved-cli-status.json --expected-run-id EXISTING_RUN_ID
```

This command reads files only. It never opens a connection, authenticates, starts a call, polls a run, or installs a schedule. It accepts only a successful terminal `get_call_run` result for the specified run. MCP call identifiers remain separate from REST call IDs. Free-text summaries, transcripts, extracted fields and provider credentials are discarded. No quote or recipient mapping is inferred, so the output remains unranked until native quote evidence exists.

Try the redacted record of the completed 53-second organizer-hotline test:

```powershell
python -m rolloffscope evidence/hotline-request.redacted.json --mcp-result evidence/hotline-run.redacted.json --expected-run-id redacted_run_20260909
```

The recipient could not supply pricing. `evidence/hotline-normalized.json` therefore has no comparable quote or ranked result. Identifiers are replaced, the request phone is a fictional reserved placeholder, and no transcript is included. See `evidence/README.md` for provenance and limits. Do not call the placeholder or treat provider task completion as a successful quote.

## Files

- `rolloffscope/`: request validation, payload, API adapter, normalization, and CLI.
- `fixtures/request.json`: fictional, live-disabled roll-off request.
- `fixtures/completed-call.json`: four deterministic results.
- `fixtures/normalization-cases.json`: locked 4-case expectation matrix.
- `fixtures/expected-normalized.json`: complete deterministic expected output.
- `tests/test_rolloffscope.py`: safety, evidence, contract, fake-API, and normalization tests.

## Limits

This local pass does not prove live schema acceptance, result quality, recipient ordering, consent, legal calling compliance, repository acceptance, competition eligibility, judging performance, an award, payout, or revenue.


## Contribution scope and authorship

RolloffScope addresses a fixed roll-off-dumpster comparison: the same container size, days, tonnage and placement, with evidence for every mandatory fee. General quote collection is adjacent prior art; this contribution makes no claim to have invented it. The decisive example is an incomplete USD350 base quote that must not outrank a complete USD615 scope-matched quote.

The project owner directed this contribution, using AI tools for implementation, synthetic examples, testing and documentation. The four quote fixtures are fictional. The separately labelled redacted hotline record derives from one completed real call; it contains no vendor quote and is not a contest acceptance or payout claim.

No ongoing schedule is installed. Closing the program ends local polling but cannot cancel an already accepted provider task. Preview and result-file modes need no login, API key, external service or package installation. Keep live access disabled for the bundled fixtures.

This demo is for bounded price-information collection. It is not suitable for emergencies or medical, legal or financial advice, and it cannot place an order or accept terms on a recipient's behalf. A responsible operator separately verifies recipient consent and applicable service rules before any live use.
