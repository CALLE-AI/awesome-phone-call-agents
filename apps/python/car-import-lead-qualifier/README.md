# Car Import Lead Qualifier

A vehicle importer collects inquiries all week — a quote form on the site, a calculator landing page, a partner dealership referral. Each row is a phone number and a sentence about a car. None of them says whether the person is ready to buy, still comparing, or already gone. Finding out means calling every row by hand, and the two leads worth a specialist's time look exactly like the rest until someone dials.

This Python app makes those calls. It rings people who already submitted a vehicle import inquiry, discloses that the caller is an AI assistant, asks seven qualification questions, and returns a schema-validated result plus one routing decision per lead: close it, book a human specialist, nurture, retry later, or stop calling this number.

**It has been run against real phone lines.** On one live call the person confirmed the inquiry, said they were ready to buy, gave a USD 20,000 budget, *corrected the delivery port* from the one on file to Nacala, and accepted a callback from a human specialist — and the structured result carries the correction instead of the stale CRM value. Live runs have exercised five of the seven routes, including the revenue route and the opt-out route. Every run, and the two defects that surfaced only in real speech, are recorded in [`docs/field-notes.md`](docs/field-notes.md).

The language and the clock come from the lead, not from the seller: the E.164 prefix of the number that is actually dialled resolves the market, and the market decides the locale, the timezone, and the local calling window. A mislabelled CRM row cannot cause a call in the wrong language or at three in the morning.

The default mode is a masked preview. It does not contact CALL-E and does not place a call. Live mode needs every lead to carry a recorded inquiry, a separate `--confirm-lead-consent` flag, and a server-side API key.

## What it does and does not do

It collects, per lead:

- right-person confirmation and consent to continue after AI disclosure;
- buying intent: ready to buy, comparing, just browsing, or not interested;
- vehicle type and a landed budget band in US dollars;
- what is blocking payment, if anything;
- the delivery port; and
- explicit consent for a human specialist to call back.

It never quotes a price, never promises availability or a delivery date, never states a customs, tax, or registration outcome, never gives legal, tax, or financial advice, and never collects payment, banking, or identity-document data. Those limits are written into the call task in [`qualifier/task.py`](qualifier/task.py) and repeated in [`docs/safety.md`](docs/safety.md).

## Layout

```text
car-import-lead-qualifier/
├── example_leads.json     # fictional placeholder numbers only
├── qualifier/
│   ├── models.py          # Lead parsing, E.164 and IANA timezone validation
│   ├── locales.py         # E.164 prefix -> market: locale, timezone, business hours
│   ├── task.py            # the spoken call task for one lead
│   ├── schema.py          # the result_schema for one lead
│   ├── runner.py          # preview / execute, idempotency, polling, CLI
│   └── routing.py         # post-call decision from the structured result
├── tests/
│   ├── fake_client.py     # fake CALL-E client: tests never place a call
│   └── test_qualifier.py
└── docs/
    ├── safety.md
    └── field-notes.md      # what six live calls returned, and what they changed
```

This app has been run against real phone lines. [`docs/field-notes.md`](docs/field-notes.md) records the six live executions, the routes they produced, the two defects they exposed, and what is still untested.

## Setup

Python 3.11 or later and `uv` are recommended:

```bash
cd apps/python/car-import-lead-qualifier
uv sync --dev
```

Copy `example_leads.json` and replace the placeholder numbers with E.164 numbers you are authorized to call. Every lead must set `submitted_import_inquiry: true`, which records that the person asked to be contacted. Parsing fails otherwise.

Only the US line in the example uses an officially reserved test range (`+1 202 555 01xx`). Mozambique publishes no documentation range, so that entry uses a structurally valid number in an unallocated prefix (`+258 80…`). It is a placeholder to be replaced, not a number to dial.

## Dry run (default)

Preview validates the file, prints the exact call arguments with masked phone numbers, and reports each lead's local time against its business hours. It needs no credentials and creates nothing:

```bash
uv run python -m qualifier.runner --leads example_leads.json
```

Useful variations:

```bash
# One lead only.
uv run python -m qualifier.runner --leads example_leads.json --lead-id lead-ao-0002

# Check what the plan looks like at a specific instant.
uv run python -m qualifier.runner --leads example_leads.json --now 2026-08-03T09:30:00Z

# Write a private plan file; existing files are never overwritten.
uv run python -m qualifier.runner --leads example_leads.json --output plan.json
```

## Live run

API keys are server credentials. Keep them in a secret manager or an environment variable, never in a lead file or in source control.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"

uv run python -m qualifier.runner \
  --leads your-authorized-leads.json \
  --execute \
  --confirm-lead-consent \
  --state-file .state/import-demo-2026-08.json \
  --output call-results.json
```

Live mode processes leads one at a time and, for each lead, creates one CALL-E call task, polls it until it reaches a terminal status, and routes the result.

## Input contract

Top level:

- `campaign_id`: stable non-secret identifier, also used for idempotency;
- `dealer_display_name`: the business name disclosed on the call;
- `leads`: 1 to 50 lead objects.

Per lead:

- `lead_id`: stable non-secret identifier, unique in the file;
- `phone`: one E.164 number, unique in the file, in a supported market;
- `submitted_import_inquiry`: literal `true`;
- `inquiry_source` and `inquiry_date` (`YYYY-MM-DD`): what the caller cites when explaining the reason for the call;
- `vehicle_interest`: short free text, spoken back to the lead;
- `destination_country`: optional ISO 3166-1 alpha-2 import destination, defaulting to the market's own region and passed to CALL-E as metadata;
- `locale`, `timezone`: optional overrides for the cases a prefix cannot know, such as a Mozambican number whose owner lives abroad.

There is deliberately no `country` field. The market comes from the dialled number, so a `country` key added to a lead is simply ignored:

| Prefix | Market | Locale | Timezone | Local window |
| --- | --- | --- | --- | --- |
| `+258` | Mozambique | `pt-MZ` | `Africa/Maputo` | 08:00-18:00 |
| `+1` | Test line | `en-US` | `America/New_York` | 09:00-20:00 |

Mozambique is the only market this app serves. `+1` is the internal test line, not a market to sell into: it exists so the call path can be exercised end to end against a reserved number. Other countries were removed rather than left in untested — adding one back means a `Market` entry here, a port list it can actually quote, and a real call placed to verify it.

Prefixes are matched longest first, so a longer market prefix always wins over a shorter one. A number outside every market is rejected at parse time with a masked error (`unsupported destination for +491***`) rather than dialled.

Do not put names, addresses, account numbers, document numbers, payment data, health or legal details, or credentials in this file.

## Business hours

Before each live call, the lead's local time is checked against its market window. Leads outside their window are **deferred**: no call is created, and the result records the next local window. Use `--allow-outside-business-hours` only when you have a specific reason to call anyway.

Calling days are one policy for the whole app (`BUSINESS_WEEKDAYS`, Monday to Friday) while the hours belong to each market. Both ignore public holidays; adjust `qualifier/locales.py` before a real campaign.

## Idempotency

Two independent guards keep an accidental rerun from becoming a second call:

1. Every call carries the idempotency key `carimport-<campaign_id>-<lead_id>-<phone digest>`, sent to CALL-E as `Idempotency-Key`. Rerunning the same attempt reuses the same key, so the provider dedupes it. The digest is the first eight hex characters of the SHA-256 of the dialled number: correcting a mistyped phone on an existing lead produces a new key and a new call, instead of being deduped against the call to the wrong number. The number itself stays out of a value that travels in headers and logs.
2. `--state-file` records each lead's attempt count, call id, and route, and is rewritten as the batch progresses. A rerun skips leads that already reached a decision, which also means an interrupted batch resumes where it stopped.

Within a single file, duplicate `lead_id` and duplicate `phone` values are rejected at parse time.

### Retrying a lead

`retry_later` is the one route that leaves a lead callable: an unanswered call, a `failed` status, or a task the provider did not complete. On the next run those leads are dialled again, and only those.

A retry carries a new key (`…-a2`, `…-a3`), because reusing the original would make the provider replay the failed call instead of dialling. The budget is `--max-attempts`, default 3; once it is spent the lead comes back as `exhausted` with a `manual_review` decision instead of being dialled forever. Attempts are counted in the state file, so without `--state-file` every run is attempt 1.

## Polling

`poll_for_result` calls `client.calls.get(call_id)` every `--poll-interval-seconds` (default 5) until the status is terminal (`completed`, `succeeded`, `failed`, `canceled`, `expired`, `no_answer`, `busy`, `declined`, `rejected`) or `--timeout-seconds` (default 600) expires. A status outside that set is treated as still running, so a final status the provider reports but this list omits costs a full timeout and stops the batch; keep `TERMINAL_STATUSES` in step with the provider. A timeout raises an error and stops the batch: the call may still be in progress, so check the CALL-E dashboard before retrying. Because the state file is written after each call, a retry resumes without re-dialling anyone already reached.

## Result schema

`qualifier/schema.py` returns one `result_schema` for every call: closed enums, `additionalProperties: false`, and a single free-text `evidence` field. Closed enums are deliberate — the answers stay comparable across calls, feed a dashboard without parsing, and are much easier for the model to get right than free text.

| Field | Values | Required |
| --- | --- | --- |
| `right_person` | `yes`, `no`, `unknown` | Yes |
| `continued_after_ai_disclosure` | `yes`, `no`, `unknown` | Yes |
| `buying_intent` | `ready_to_buy`, `comparing`, `just_browsing`, `not_interested`, `unknown` | Yes |
| `payment_blocker` | `none`, `forex_unavailable`, `transfer_limit`, `deposit_too_high`, `needs_financing`, `awaiting_funds`, `unknown` | Yes |
| `evidence` | short paraphrase, no phone numbers | Yes |
| `vehicle_type` | `sedan`, `suv`, `pickup`, `minibus`, `truck`, `other`, `unknown` | No |
| `budget_band_usd` | `under_5k`, `5k_10k`, `10k_20k`, `over_20k`, `unknown` | No |
| `destination_port` | `maputo`, `beira`, `nacala`, `other`, `unknown` | No |
| `wants_human_callback` | `yes`, `no`, `unknown` | No |

The spoken options in `qualifier/task.py` are read from this schema, so the script and the extraction cannot drift apart. Optional fields that come back absent are read as `unknown`.

The schema has been refined once against real results: a compound question that silently dropped `vehicle_type`, and budget bands whose borders were ambiguous at the boundary. Both are written up in [`docs/field-notes.md`](docs/field-notes.md).

One known edge remains: `budget_band_usd` is fixed in US dollars, which is the currency import quotes are written in here but not the one the lead pays in. Changing that means adding enum values here and a matching line in `task.py`. The `destination_port` enum lists Mozambican ports, which now matches the only market served.

## Routing

`qualifier/routing.py` decides from the structured result only; it never reads a transcript.

| Route | When | Follow-up allowed |
| --- | --- | --- |
| `suppress_number` | Wrong person, or declined to continue after AI disclosure | No, stop calling the number |
| `close_lead` | Does not want a callback, or not interested | No |
| `retry_later` | Deferred by business hours, unanswered or declined call, or task not completed | Yes |
| `manual_review` | Low completion confidence, missing result, unclear intent, or unclear callback consent | Yes |
| `book_specialist_callback` | Ready to buy, consent given, nothing blocking payment | Yes, `high` priority |
| `payment_support` | Ready to buy or comparing, but blocked by forex, a transfer limit, deposit size, financing, or funds in transit | Yes |
| `nurture_sequence` | Comparing or browsing with no payment blocker | Yes |

Opt-out signals are evaluated before any commercial signal, so a wrong-person or declined-disclosure answer suppresses the number even when the provider reports an incomplete task. A callback is only booked on an explicit `wants_human_callback: yes`; `unknown` goes to `manual_review` so a person decides before another call happens.

A provider decline is treated as retryable rather than as an opt-out, because CALL-E reports one both when a person refuses the call and when the route failed before any media was established. The attempt budget bounds it: after `--max-attempts` the lead becomes `exhausted` with a `manual_review` decision instead of being dialled for ever. A refusal spoken on the call is a separate signal, and `right_person` or `continued_after_ai_disclosure` still suppress the number.

`completion_confidence` arrives from CALL-E as `{"score": 0.66, "label": "medium"}`. The score is what feeds the `manual_review` gate below `0.8`; a plain float is still accepted.

`payment_support` exists because in this market a blocked payment is usually not a lost sale: a buyer waiting on foreign currency needs a different team than a buyer who is still browsing. The blocker is echoed on the decision so the queue can be split by cause.

## Side effects and safety

- A live run places one real outbound phone call per non-deferred, non-skipped lead. There is no batch parallelism and no recurring schedule.
- A number whose prefix has no market is never dialled, so a typo in the country code fails loudly instead of reaching a stranger abroad.
- The agent discloses that it is an AI before asking anything, and ends the call immediately on a wrong-person answer, a refusal, or a removal request.
- Phone numbers are masked everywhere except in the request sent to CALL-E, and phone-like digit runs are stripped from the returned evidence text.
- Results deliberately exclude transcripts and provider events, which may contain personal data.
- Output files are created with mode `0600` and are never overwritten.
- This workflow is not for medical, legal, financial, emergency, collections, political, or unsolicited marketing calls. Cold lists are out of scope: a lead must have asked to be contacted.

Read [`docs/safety.md`](docs/safety.md) before a live run.

## Cancellation and rollback

Preview has no side effect and needs no rollback. Before a live run, stop by omitting `--execute` or `--confirm-lead-consent`.

Once the provider accepts a call task, this app cannot cancel it; use the CALL-E dashboard or provider controls if they expose a cancel action. The call script always lets the person decline or hang up. The app creates no recurring job and nothing to unschedule.

### Aborting a batch

A batch stops at the first lead that raises an error, and `Ctrl+C` stops it wherever it happens to be. Leads are processed one at a time, so an abort splits the batch into three groups:

| Group | State | On the next run |
| --- | --- | --- |
| Leads already decided | Written to the state file | Skipped, or redialled if the route was `retry_later` |
| The lead in flight | **Not** written to the state file | Dialled again under the same idempotency key |
| Leads not yet reached | Nothing exists | Dialled normally |

**The state file is the durable record, not the output file.** `--state-file` is rewritten after every lead that reaches a decision, through a temporary file and an atomic replace at mode `0600`, so an abort cannot leave it half-written. `--output` is written only once, after the last lead, so an aborted batch produces **no result file at all** — the routing decisions for the leads already called survive only in the state file. Run with `--state-file` if an interruption is a possibility.

Deferred, skipped, and exhausted leads are never recorded, so a batch aborted outside business hours leaves no trace to clean up.

### The lead in flight

One lead can be mid-call when the abort lands: `execute_lead` creates the call, then polls it, and the state entry is only written once a route exists. Abort in that window — a `Ctrl+C`, a poll timeout, a provider error — and the call exists at CALL-E while nothing local records it.

This is why the attempt counter lives in the state file. With no entry, the lead is attempt 1 again on the next run, which regenerates the *same* idempotency key, and the provider dedupes it instead of dialling a second time. The person is not called twice; the rerun returns the original call. A poll timeout is the case worth checking by hand, because the call may still have been in progress when the timeout fired — confirm on the CALL-E dashboard before rerunning.

### Resuming

Rerun the same command with the same `--leads` file and the same `--state-file`, and give `--output` a path that does not exist yet:

```bash
uv run python -m qualifier.runner \
  --leads your-authorized-leads.json \
  --execute --confirm-lead-consent \
  --state-file .state/import-demo-2026-08.json \
  --output call-results-resume.json
```

Reusing the previous `--output` path fails with `error: [Errno 17] File exists` and exit code 2 before any call is placed, because result files are never overwritten. That is a guard, not a bug: pick a new name per run and keep the state file constant.

### Discarding

To abandon a batch, simply stop rerunning it. Nothing is scheduled and nothing retries on its own.

Deleting the state file does **not** undo the calls already placed, and it does not make them repeatable either: every lead reverts to attempt 1, regenerating the keys already used, so a compliant provider dedupes them for as long as it retains them. Deleting the file mainly costs you the record of what was decided.

To deliberately call a lead again, change `campaign_id` in the lead file. It is part of the key (`carimport-<campaign_id>-<lead_id>-<phone digest>`), so a new campaign is a genuinely new call rather than a replay of the old one — and it keeps the previous campaign's decisions intact for audit. Do this only for a lead whose route allows another call: `suppress_number` and `close_lead` mean the person is done being called, and no key change makes that acceptable.

Rolling back your own side means applying the decisions, not deleting them: carry every `suppress_number` into your CRM so the number is never dialled again by this or any other workflow.

## Validation

Default tests inject the fake client in `tests/fake_client.py` and never place a phone call:

```bash
uv run pytest -q
python3 ../../../scripts/validate_repository.py
```

For opt-in live verification, use a phone you own or are authorized to call, keep only the redacted result, and do not commit the lead file, the state file, or the result file.
