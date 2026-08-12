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
- Direct CALL-E execution with a fixed structured result schema and the
  business outcomes `interested`, `call_back_later`, `no_answer`, and `busy`.
- Atomic Quote + Task write-back through one Salesforce Composite API request.
- Bounded, rotating, human-readable logs and a per-run `--max-calls` limit.

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
| `Task` | Stores each completed follow-up activity, linked to the Quote (`WhatId`) and Contact (`WhoId`). |

The deployed QuoteWake custom fields are:

On `Quote`:

- `QuoteWake_Enabled__c`: opt a Quote into automation.
- `Follow_Up_Status__c`: `Retry`, `Completed`, or `Stopped` after processing;
  blank means the initial follow-up is pending. `In Progress` is reserved in
  the Salesforce picklist and treated as non-actionable by the current worker.
- `Next_Follow_Up_At__c`: persisted retry time, stored by Salesforce as a
  DateTime.
- `Attempt_Count__c`: completed business attempts; technical CALL-E failures do
  not consume one.

On `Contact`:

- `QuoteWake_Call_Locale__c`: BCP-47 locale required by CALL-E.

An opt-out field is optional because Salesforce orgs differ: configure a
Contact checkbox API name with `SALESFORCE_DO_NOT_CALL_FIELD` or
`--do-not-call-field`. If it is not configured, QuoteWake cannot apply that
field-level opt-out filter.

No custom call-history object is required today. The standard Task is the
Salesforce activity record. QuoteWake writes the three follow-up fields above;
it does not overwrite commercial Quote amount, status, expiration, or other
business fields.

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
  --country-code ES \
  --call-locale es-ES \
  --test-phones "+14155550101"
```

Use only E.164 numbers that you are authorized to call. The script stores test
numbers in the demo Contacts in Salesforce; it does not add them to the
repository. Omit `--test-phones` when live calling is not authorized.

The CLI provides a safe default plus two explicit, mutually exclusive modes:

```shell
# Default: read Salesforce and preview the selected calls; no CALL-E call or write.
uv run python -m quotewake_salesforce --max-calls 1

# Render selected prompts; no CALL-E call or Salesforce write.
uv run python -m quotewake_salesforce --show-prompt --max-calls 1

# Explicit live mode: place calls and persist results.
uv run python -m quotewake_salesforce --execute --max-calls 1
```

Use `--config /path/to/quotewake.toml` to select another TOML file. The default
configuration is the repository's [`quotewake.toml`](quotewake.toml).

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
| `CALLE_BASE_URL` | Optional | CALL-E API base URL; defaults to `https://api.heycall-e.com`. |
| `QUOTEWAKE_ALLOWED_QUOTE_STATUSES` | Optional | Comma-separated replacement for the default `Presented` status. |

Exported environment variables take precedence over `.env`. Keep `.env` out of
version control and never commit credentials, access tokens, or real customer
phone data.

### TOML policy

The shipped [`quotewake.toml`](quotewake.toml) contains the following policy
shape and defaults:

```toml
[selection.initial_follow_up]
minimum_delay_hours = 0
standard_delay_hours = 0
due_soon_window_days = 0

[follow_up.retry]
max_attempts = 3
retry_delays_days = [2, 4]
retry_outcomes = ["call_back_later", "no_answer", "busy"]
technical_failure_retry_delay_minutes = 30
completed_outcomes = ["interested"]

[call]
# Optional. The default prompt is used when this is omitted.
prompt = "Follow up quote {quote_name} with {contact_name} at {account_name}."

[logging]
directory = "logs"
format = "text"
level = "INFO"
max_bytes = 5242880
backup_count = 5
```

`max_attempts` includes the first business call, so
`retry_delays_days` must contain exactly `max_attempts - 1` values. The
`[call].prompt` template may use only `{locale}`, `{region}`,
`{contact_name}`, `{account_name}`, `{quote_name}`, `{quote_total}`,
`{expiration_date}`, `{attempt_count}`, and `{quote_items}`. Fixed compliance
rules are appended to every rendered prompt. Relative log directories are
resolved from the application directory.

## Outcomes, retries, and write safety

CALL-E business results use a deliberately small vocabulary:

| Result | Salesforce effect |
| --- | --- |
| `interested` | Increment `Attempt_Count__c`; mark the Quote `Completed`. |
| `call_back_later`, `no_answer`, `busy` | Increment the business attempt and schedule `Retry` using the configured delay; after the maximum, mark `Stopped`. A future customer date is used when valid. |
| Provider terminal failure (`failed`, `canceled`, or `cancelled`) | Persist `Retry` without consuming a business attempt and use the configured technical retry delay. |

Malformed structured results, unsupported outcomes, CALL-E create failures,
wait failures, and parse failures are rejected. They do not produce a business
outcome or Salesforce write for that call; the failure is logged with a bounded
phase/reason and the one-shot run can continue with the next candidate.

Each CALL-E request receives a deterministic idempotency key based on the Quote
ID and next attempt. A persisted `Next_Follow_Up_At__c` marker is incorporated
for technical retries, while an ambiguous provider request can be retried with
the same key. This protects the provider boundary; Salesforce write-side
deduplication beyond the transaction below is not implemented.

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
That checkbox alone is not consent management or legal compliance, and
QuoteWake does not automatically persist a recipient's spoken do-not-call
request. Teams must implement the appropriate Salesforce workflow, consent
records, suppression rules, and lawful calling process before live use.

Credentials and raw provider payloads are not written to application logs;
phone-like values are redacted and error logs use exception types and bounded
reasons. `--show-prompt` intentionally prints Salesforce-derived business
context, so treat its output and the rotating `logs/quotewake.log` file as
business data and protect them accordingly.

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
