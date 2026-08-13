# QuoteWake

Many businesses manage their sales cycle in Salesforce, but manually calling
back every Quote—especially the many lower-value Quotes—does not scale. QuoteWake
is a Salesforce-first integration and companion service that connects that
pipeline to CALL-E, then brings a structured call result back into Salesforce.

QuoteWake is a small Python service for commercial teams already using
Salesforce. It is deliberately an integration companion, not a native
Salesforce plug-in or a managed package. Salesforce remains the system of
record; QuoteWake does not create a second database.

## Who it is for

QuoteWake is aimed at small and midsize sales teams that already keep Quotes,
Accounts, Opportunities, and Contacts in Salesforce and need a practical way
to follow up a high volume of commercial proposals without asking a seller to
remember every call.

## Workflow

```text
Salesforce Quotes
      │ SOQL / REST
      ▼
QuoteWake ── select, build context, enforce policy ──┐
      │                                               │
      └──────── CALL-E dry-run or outbound call ◄─────┘
                              │ structured result
                              ▼
              Salesforce Quote + completed Task
```

The normal workflow is:

1. Read Quotes and their related Opportunity, Account, Contact, and line-item
   context from Salesforce.
2. Select eligible Quotes and resolve exactly one primary contact.
3. Build a bounded CALL-E task from the commercial context.
4. Preview the request or place the call and wait for its structured result.
5. Update the Quote follow-up state and create a completed standard Task.

## Functionality today

- Headless Salesforce OAuth 2.0 Client Credentials authentication and REST/SOQL
  access.
- Quote eligibility checks for enablement, Quote status, open Opportunity,
  expiration, follow-up state, attempt count, due time, contact role, phone,
  and optional opt-out field.
- Quote-line context (up to the first ten lines) in the CALL-E task, with the
  Contact locale, Account country, and Salesforce organization regional settings.
- Safe dry-run output without creating a CALL-E client, placing a call, or
  writing Salesforce records.
- Direct CALL-E execution with a fixed structured result schema and the seven
  explicit business outcomes listed in the outcomes table below.
- Atomic Quote + Task write-back through one Salesforce Composite API request.
- Bounded, rotating, human-readable service-tagged logs, a final line-by-line
  call result summary, and a per-run `--max-calls` limit.

### Selection truth

The current Salesforce query orders candidates by `CreatedDate ASC`. QuoteWake
then evaluates them in Python; it does not score or rank them by account value,
Quote amount, expiration urgency, engagement, or any other priority signal.
`--max-calls` takes the first READY candidates in that order (default: `10`) in
both dry-run and execute modes. It is a throughput limit, not a concurrency
lock.

By default, a Quote is READY when it is enabled, has status `Presented`, belongs
to an open Opportunity, is not expired, is below the configured maximum of three
business attempts, and has either a blank follow-up status or a due `Retry`
status. The initial timing policy uses `LastModifiedDate`; a `Retry` uses
`Next_Follow_Up_At__c`. The candidate must also have exactly one primary
`OpportunityContactRole`, a valid phone (MobilePhone is preferred over Phone),
and must not match a configured opt-out field. `Completed`, `Stopped`, invalid,
and otherwise non-actionable states are skipped.

The default `quotewake.toml` sets initial delays to zero for a demonstrable
dataset. Set non-zero values for a real operating cadence. Allowed Quote
statuses can be repeated with `--allowed-quote-status` or configured with the
`QUOTEWAKE_ALLOWED_QUOTE_STATUSES` environment variable.

## Salesforce model

Salesforce standard objects are used wherever possible:

| Object | How QuoteWake uses it |
| --- | --- |
| `Quote` | Reads commercial state and writes follow-up state. Standard fields include `Name`, `Status`, `ExpirationDate`, `LastModifiedDate`, amount/currency, and `OpportunityId`. |
| `Opportunity` | Resolves the related opportunity and checks `IsClosed`. |
| `Account` | Supplies the account name and `BillingCountryCode` for call context. |
| `Contact` | Supplies the callable person, `MobilePhone`/`Phone`, and call locale. |
| `OpportunityContactRole` | Requires exactly one primary contact for the opportunity. |
| `QuoteLineItem` / `Product2` | Supplies concise product, quantity, and line-total context. |
| `Organization` | Supplies `TimeZoneSidKey` and `DefaultLocaleSidKey` for regional formatting. |
| `Task` | Stores each persisted follow-up result, linked to the Quote (`WhatId`) and Contact (`WhoId`), with the commercial outcome in the subject and a multiline description. |

The deployed QuoteWake custom fields are:

On `Quote`:

- `QuoteWake_Enabled__c`: opt a Quote into automation.
- `Follow_Up_Status__c`: `Retry`, `Completed`, or `Stopped` after processing;
  blank means the initial follow-up is pending. `In Progress` is reserved in
  the Salesforce picklist and treated as non-actionable by the current worker.
- `Next_Follow_Up_At__c`: persisted retry time, or the UTC reset-generation
  marker when `Follow_Up_Status__c` is blank; stored by Salesforce as a
  DateTime.
- `Attempt_Count__c`: completed business attempts; technical CALL-E failures do
  not consume one.

On `Contact`:

- `QuoteWake_Call_Locale__c`: call locale stored in Salesforce form (for
  example `en_US`) and normalized to CALL-E's BCP-47 form (`en-US`) at the
  provider boundary.

An opt-out field is optional because Salesforce orgs differ: configure a
Contact checkbox API name with `SALESFORCE_DO_NOT_CALL_FIELD` or
`--do-not-call-field`. If it is not configured, QuoteWake cannot apply that
field-level opt-out filter.

No custom call-history object is required today. The standard Task is the
Salesforce activity record. QuoteWake writes the three follow-up fields above;
it does not overwrite commercial Quote amount, status, expiration, or other
business fields.

Task subjects use `QuoteWake call outcome: <outcome>`; `unknown` adds
`(human review)`. The description keeps the summary and next action on separate
lines and includes the CALL-E call ID. A Task is created whenever QuoteWake
obtains a terminal result that it can safely persist, including commercial
outcomes and terminal technical failures. Create/wait errors with no accepted
terminal result do not create a Task.

## Quick demo

### Requirements

- Python 3.11 or newer.
- [`uv`](https://docs.astral.sh/uv/) for the Python environment.
- Salesforce CLI (`sf`) and `jq` for Salesforce metadata/demo setup.
- A Salesforce org with Quotes enabled, the QuoteWake metadata deployed, and an
  External Client App configured for runtime OAuth.
- A CALL-E API key only when making live calls.

Install the project and create a private local environment file:

```shell
uv sync
cp .env.example .env
chmod 600 .env
```

Fill in the environment values described below. For a Salesforce demo org,
authenticate the CLI and deploy metadata with the included idempotent setup
script:

```shell
sf org login web --alias quotewake-dev --set-default
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --seed-data \
  --country-code US \
  --call-locale en_US
```

Use only E.164 numbers that you are authorized to call. The script stores test
numbers in the demo Contacts in Salesforce; it does not add them to the
repository. The defaults are `US` for Account `BillingCountryCode` and
`en_US` for the Salesforce Contact locale; QuoteWake converts that underscore
form to the CALL-E-required BCP-47 form `en-US` at the domain boundary. When
`--test-phones` is omitted, newly created Contacts receive fictional fixture
numbers and both existing demo Contact phone fields (`Phone` and
`MobilePhone`) are preserved exactly during `--reset-data` unless
`--test-phones` is explicitly supplied.
Omit `--test-phones` when live calling is not authorized.

`--reset-data` starts a new demo generation. It creates one UTC timestamp for
the whole reset and stores that same value in `Next_Follow_Up_At__c` on all
10 demo Quotes while leaving `Follow_Up_Status__c` blank and resetting
`Attempt_Count__c` to zero. When the status is blank, that timestamp is a
generation marker rather than a retry due date, so the initial READY rules
continue to use `LastModifiedDate`. A later reset receives a new marker and
therefore a new CALL-E idempotency key for the first attempt. A regular
`--seed-data` run preserves the existing follow-up fields, so repeating it
does not change that key.

The CLI provides a safe default plus two explicit, mutually exclusive modes:

```shell
# Default: read Salesforce and preview the selected calls; no CALL-E call or write.
uv run python -m quotewake_salesforce --max-calls 1

# Render selected prompts; no CALL-E call or Salesforce write.
uv run python -m quotewake_salesforce --show-prompt --max-calls 1

# Explicit live mode: place calls and persist results.
uv run python -m quotewake_salesforce --execute --max-calls 1

# Test/support mode: use a new suffix when intentionally starting a fresh
# provider request with the same Quote/attempt data.
uv run python -m quotewake_salesforce --execute --idempotency-suffix test-02 --max-calls 1
```

Use `--config /path/to/quotewake.toml` to select another TOML file. The default
configuration is the repository's [`quotewake.toml`](quotewake.toml).

`--idempotency-suffix` is an optional test/support escape hatch for avoiding a
CALL-E idempotency conflict while repeatedly testing the same Quote. It is
appended to the deterministic key after the Quote, attempt, and retry marker;
the same suffix produces the same key and a different suffix produces a new
key. It accepts an ASCII alphanumeric first character followed by ASCII
letters, digits, `.`, `_`, or `-`, up to 32 characters. Omit it in normal
production runs so retries continue to reuse their original key.

After an execute run, QuoteWake prints only the calls whose result was safely
persisted, one per line, using the same Quote presentation as selection:

```text
Call results:
Quote 0Q0123456789ABC: Example Quote | $1,250.00 | CALLED (no_answer)
```

### Query QuoteWake state

Use the Salesforce CLI wrapper to inspect Quote status and follow-up fields:

```shell
./scripts/query-quotes.sh --target-org quotewake-dev
```

If the Salesforce CLI already has a default org, omit `--target-org`. In an
interactive terminal the script opens `less -S`; use the left/right arrow keys
to scroll across wide columns and `q` to exit. Redirected and CI output is
written directly without a pager.

### Manually update a Quote

For a one-off Salesforce state change, use `scripts/update-quote.sh` with a
15- or 18-character Quote ID beginning with `0Q`. It queries the record before
and after the update and changes only the requested QuoteWake fields:

```shell
./scripts/update-quote.sh 0Q0123456789ABC --enabled true --attempt-count 1
./scripts/update-quote.sh 0Q0123456789ABC --retry-in 1d2h30m
./scripts/update-quote.sh 0Q0123456789ABC --retry-at 2026-08-13T10:30:00+00:00
./scripts/update-quote.sh 0Q0123456789ABC --clear-follow-up-status --clear-retry
```

`--follow-up-status` accepts only `In Progress`, `Retry`, `Completed`, or
`Stopped`. A retry duration is a strict, ordered, positive composition of
integer `d`, `h`, `m`, and `s` components, with each unit used at most once
(for example `2d`, `30m`, or `1d2h30m15s`). `--retry-at` accepts UTC ISO 8601
timestamps ending in `Z` or `+00:00`; the latter is normalized to `Z`. Either
retry option automatically sets the status to `Retry`.

## Configuration and environment

Runtime Salesforce authentication is server-to-server OAuth. Create an
External Client App with the `api` scope and Client Credentials Flow, assign a
dedicated execution user, and grant only the read access needed for `Quote`,
`Opportunity`, `Account`, `Contact`, `OpportunityContactRole`,
`QuoteLineItem`, `Product2`, and `Organization`, plus permission to update
`Quote` and create `Task`. Salesforce CLI login is used by the setup script
only; it is not used for application runtime authentication.

Copy the placeholders from [`.env.example`](.env.example):

| Variable | Required | Purpose |
| --- | --- | --- |
| `SALESFORCE_DOMAIN` | Every run | Salesforce My Domain URL, without the token path. |
| `SALESFORCE_CLIENT_ID` | Every run | External Client App consumer key. |
| `SALESFORCE_CLIENT_SECRET` | Every run | External Client App consumer secret. |
| `SALESFORCE_API_VERSION` | Every run | REST API version such as `v67.0`; the application also accepts `67.0` and normalizes the `v` prefix. |
| `SALESFORCE_CURRENCY_CODE` | Single-currency orgs when `CurrencyIsoCode` is unavailable | Three-letter ISO currency code, such as `EUR`. |
| `SALESFORCE_DO_NOT_CALL_FIELD` | Optional | Contact checkbox API name used to skip opted-out contacts. |
| `CALLE_API_KEY` | `--execute` only | CALL-E API credential. |
| `CALLE_BASE_URL` | Optional | Official CALL-E HTTPS origin only; defaults to `https://api.heycall-e.com`. Do not add a path, credentials, query, or fragment. |
| `QUOTEWAKE_ALLOWED_QUOTE_STATUSES` | Optional | Comma-separated replacement for the default `Presented` status. |

Exported environment variables take precedence over `.env`. Keep `.env` out of
version control and never commit credentials, access tokens, or real customer
phone data.

### TOML policy

The shipped [`quotewake.toml`](quotewake.toml) contains the following policy
shape and defaults:

```toml
[selection.initial_follow_up]
minimum_delay = "0s"
standard_delay = "0s"
due_soon_window = "0s"

[follow_up.retry]
max_attempts = 3
retry_delays = ["2d", "4d"]
retry_outcomes = ["call_back_later", "no_answer", "busy"]
technical_failure_retry_delay = "30m"
completed_outcomes = ["interested"]

[call]
wait_timeout_seconds = 600
# Optional. The default prompt is used when this is omitted.
prompt = "Follow up quote {quote_name} with {contact_name} at {account_name}."

[logging]
directory = "logs"
format = "text"
level = "INFO"
max_bytes = 5242880
backup_count = 5
# Temporary, sensitive support diagnostics; disabled by default.
raw_calle_api = false
```

`max_attempts` includes the first business call, so
`retry_delays` must be an array of strict compact duration strings containing
exactly `max_attempts - 1` values. Durations use ordered integer `d`, `h`, `m`,
and `s` components, with each unit at most once (for example `1d2h30m15s`).
Configuration accepts `0s` where a zero delay is useful. The
`retry_outcomes` and `completed_outcomes` lists are validated against the
fixed policy vocabulary shown in the table; unsupported or alternate mappings
are rejected rather than silently ignored. The
`[call].prompt` template may use only `{locale}`, `{region}`,
`{contact_name}`, `{account_name}`, `{quote_name}`, `{quote_total}`,
`{expiration_date}`, `{attempt_count}`, and `{quote_items}`. Fixed compliance
rules are appended to every rendered prompt. Relative log directories are
resolved from the application directory.

`call.wait_timeout_seconds` is the maximum time in seconds that the SDK polls
for a non-terminal CALL-E result; it does not delay a terminal response. For
example, a provider `failed` result such as `call_not_ready` finishes as soon
as CALL-E reports it rather than using the full 600-second limit. QuoteWake
keeps the official synchronous
`create` + `wait_for_result` flow and uses a two-second polling interval.

The shipped configuration uses `INFO`. At that level, the console shows the
main completed Salesforce and CALL-E operations plus QuoteWake lifecycle
events. Lines use the form
`timestamp [LEVEL] [Service] [event]: details`, with high-contrast service and
event colors on interactive terminals. `NO_COLOR` disables ANSI colors, and
rotating files never contain ANSI sequences. The internal run correlation ID
is retained on records but omitted from human-readable lines.

Set `logging.level = "DEBUG"` when detailed API boundaries are needed. DEBUG
events record only safe operational metadata:
Salesforce service/method/route, HTTP status, and elapsed time, plus CALL-E
operation phase, Quote ID, idempotency key, call ID, provider status, and
elapsed time. Query strings, SOQL, headers, request bodies, prompts,
recipients, phone numbers, and raw provider results are not included unless
the opt-in setting below is enabled. The CALL-E `wait_for_result` event is one
aggregate wait boundary because the SDK performs polling internally; QuoteWake
does not emit one log event per poll.

For temporary support investigations, set `logging.raw_calle_api = true` while
keeping `logging.level = "DEBUG"`. QuoteWake then emits clearly labelled
`call_e_raw_request` and `call_e_raw_response` events for CALL-E create and
wait operations. These payloads are recursively sanitized: recipient values
under `phone`/`phones` are intentionally preserved for support, while
phone-like values in free text and all credentials are redacted. HTTP
`Authorization`, API-key, and header fields are never logged. Tasks and
structured results can still contain sensitive business data, so enable this
setting only for the duration of the investigation, protect the log file, and
turn it off afterwards. The default is `false`.

## Outcomes, retries, and write safety

CALL-E business results use this explicit vocabulary and deterministic policy:

| Intent | Quote effect | Attempt consumed? | Next action |
| --- | --- | --- | --- |
| `interested` | Increment `Attempt_Count__c`; mark `Completed`. | Yes | No automated retry. |
| `call_back_later` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use a future requested date; otherwise the configured delay. |
| `not_interested` | Increment the count; mark `Stopped`. | Yes | No automated retry. |
| `stop_quote_follow_up` | Increment the count; mark `Stopped`. | Yes | Stop this Quote's follow-up and record the request in a Task; no Contact update. |
| `unknown` | Increment the count; mark `Stopped`. | Yes | Create a human-review Task; do not infer an intention or redial automatically. |
| `no_answer` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use the configured retry delay. |
| `busy` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use the configured retry delay. |

Provider and boundary failures are not business attempts:

| Failure | Salesforce write | Attempt consumed? | Next action |
| --- | --- | --- | --- |
| Terminal CALL-E `failed`/`canceled` without a valid `no_answer`/`busy` disposition | Atomic Quote `Retry` update plus Task | No | Retry after the technical delay. |
| Create `auth`, `balance`, `rate`, `schema`, `recipient`, `policy`, deterministic `idempotency`, or `call_not_ready` rejection (HTTP 4xx) | No commercial write | No | Fix the reported code/reason before a deliberate retry; review CALL-E task and recipient readiness for `call_not_ready`. |
| Create `timeout`, `connection`, or `provider` failure without HTTP status or with HTTP 5xx | No commercial write | No | Creation may be unknown; reconcile first and, if replaying creation, reuse the exact same idempotency key. |
| Any wait failure after a confirmed call ID, including HTTP 4xx/5xx, timeout, or connection failure | No commercial write | No | Terminal result is unknown; reconcile the accepted call ID before any new attempt. Do not replay creation; use the reported classification/code to fix the poll problem. |
| Malformed structured result or invalid `task_completed` type | No commercial write | No | Send to operator review; never persist a guessed outcome. |

Malformed structured results, unsupported outcomes, CALL-E create failures,
wait failures, and parse failures are rejected. They do not produce a business
outcome or Salesforce write for that call; the failure is logged with bounded
classification, HTTP status, code, and reason values and the one-shot run can
continue with the next candidate. A create response without a confirmed call ID
is treated as indeterminate: reconcile or replay with the exact same
idempotency key and do not generate a new call attempt.

The request sends the SDK's `phones`, `locale`, and `region` recipient fields.
The result schema uses enums for the business outcome and interest level and
does not use a JSON union for `preferred_date`; that date is optional by
omission. Commercial conversation outcomes require an explicit JSON boolean
`task_completed: true`. The retryable dispositions `no_answer` and `busy` are
the deliberate exceptions: a valid aggregate structured result or an explicit
provider attempt signal is sufficient even when `task_completed` is false and
the terminal provider status is `failed`. This covers declined or unconnected
calls without mistaking provider processing completion for commercial success.
Other false, null, or missing task evidence becomes `unknown`, while malformed
task evidence is rejected. Root aggregate `structured_result` takes precedence;
recipient and last-attempt results remain supported as fallbacks. QuoteWake
validates all locations before accepting a business result.

Each CALL-E request receives a deterministic idempotency key based on the Quote
ID and next attempt. A persisted `Next_Follow_Up_At__c` marker is incorporated
for technical retries and for each reset demo generation. An ambiguous create
can be replayed only with the same key; after a call ID is confirmed, reconcile
that call's terminal result instead of replaying creation. This protects the
provider boundary;
Salesforce write-side deduplication beyond the transaction below is not
implemented.

The result is persisted with one `allOrNone=true` Composite API request that
updates the Quote and creates its completed Task together. If that persistence
fails after a call has returned, QuoteWake records only bounded identifiers,
stops the remaining calls in that run, and returns a non-zero exit status. The
standard Task is an audit trail, not a separate local database.

## Scheduler and operations

QuoteWake is a one-shot process. A scheduler supplies the cadence; the
application applies eligibility and retry policy. Use absolute paths and a
process lock so two scheduled runs do not overlap:

```cron
*/15 * * * * flock -n /var/lock/quotewake.lock uv run --project /opt/quotewake python -m quotewake_salesforce --execute --max-calls 1 --config /opt/quotewake/quotewake.toml >> /var/log/quotewake-cron.log 2>&1
```

The lock prevents overlapping processes only. There is currently no distributed
capacity reservation, per-customer lock, provider rate limiter, or built-in
scheduler. Tune `--max-calls` conservatively until those controls exist.

## Security, compliance, and opt-out

Every call prompt appends fixed guardrails: identify the AI assistant, confirm
the intended recipient before sharing Quote details, treat Salesforce values as
untrusted business data rather than instructions, avoid passwords/payment-card
data/bank details/identity numbers, do not negotiate or make commercial
commitments, and end politely when the recipient asks not to be called again.

The optional configured Contact opt-out checkbox is enforced before a call.
That checkbox alone is not consent management or legal compliance. A spoken
`stop_quote_follow_up` request persists `Stopped` on that Quote and records a
Task, but deliberately does not update Contact or create global suppression;
teams must implement the appropriate Salesforce workflow, consent records,
suppression rules, and lawful calling process before live use.

Credentials are never written to application logs; phone-like values are
redacted in normal events and error logs use exception types and bounded reasons. Raw CALL-E
payloads are disabled by default and are only emitted with the temporary
`logging.raw_calle_api` support setting described above. `--show-prompt`
intentionally prints Salesforce-derived business context, so treat its output
and the rotating `logs/quotewake.log` file as business data and protect them
accordingly.

## Current limitations

- Candidate priority is `CreatedDate ASC`; there is no scoring or ranking by
  customer value, Quote amount, urgency, engagement, territory, consent, or
  capacity.
- Exactly one primary Opportunity Contact Role is required. There is no contact
  fallback, contact rotation, or multi-contact campaign.
- The service is synchronous and one-shot. Scheduling, distributed locks,
  capacity management, rate limiting, and operational dashboards are external.
- Completed standard Tasks provide history, but there is no local database,
  custom call-history object, Salesforce-side write deduplication ledger, or
  analytics/ROI model.
- The live path depends on CALL-E availability and credentials. Normal tests use
  mocks and do not place calls or contact Salesforce.
- QuoteWake currently does not add Salesforce Flow, Platform Events, Change Data
  Capture, Agentforce, or Apex automation, and is not a Salesforce-native
  package.

## Roadmap

Priorities follow the operational need rather than adding Salesforce technology
for its own sake:

1. Make selection useful at scale with customer/account value, Quote amount,
   expiration urgency, and prior engagement/activity signals.
2. Add policy-aware territory, local calling time, consent, and opt-out handling,
   then capacity controls, per-Quote locks, and provider rate limiting.
3. Add Salesforce-backed analytics and ROI reporting for follow-up performance.
4. Consider Salesforce Flow, events/CDC, Agentforce actions, or Apex only when a
   demonstrated workflow requirement justifies the additional complexity.

## Tests

Unit and integration-boundary tests use mocks; they do not place real calls or
contact Salesforce:

```shell
uv run pytest
uv lock --check
git diff --check
```
