# QuoteWake

QuoteWake is a Salesforce-first MVP for selecting commercial Quotes and preparing
their phone follow-up in CALL-E. The default dry-run reads Salesforce, evaluates
eligibility, resolves a callable Contact, and reports `READY` or `SKIP`. An
explicit planning option sends only `READY` records to CALL-E `plan_call` and
writes a redacted local report. The separate ES simulator exercises write-back
with an explicit demo-only confirmation and never places an outbound call.

## Workflow

1. Read Salesforce `Quote` records and their related open `Opportunity`.
2. Evaluate QuoteWake enabled/status/due/attempt/expiration/commercial-status rules in Python.
3. Resolve the primary `OpportunityContactRole` only.
4. Validate opt-out and phone availability.
5. Optionally load Quote line items in one batched SOQL query.
6. Build a deterministic, safety-bounded CALL-E goal for each `READY` Quote.
7. Call `plan_call` only and write a redacted local JSONL report.

The retry policy is application configuration for the MVP: `MAX_ATTEMPTS = 3`. No external database or `Max_Attempts__c` field is used.

## Requirements

- Python 3.11 or newer.
- Salesforce CLI (`sf`) in WSL.
- An authenticated Salesforce Developer Org with the QuoteWake fields already deployed.
- The official CALL-E CLI (`calle`) and an authenticated CALL-E session when
  using `--plan-calls`.

## Salesforce setup

From this directory, authenticate the Developer Org if needed:

```bash
sf org login web --alias quotewake-dev --set-default
```

Deploy QuoteWake metadata to the authenticated org:

```bash
./scripts/setup-salesforce.sh --target-org quotewake-dev
```

To create the reusable fictional demo dataset (10 Quotes, 10 Opportunities and
9 Accounts):

```bash
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --seed-data
```

The seed preserves the four original electrical-services scenarios and adds six
safe fictional scenarios. One demo Account intentionally owns two of the ten
demo Opportunities, and each Opportunity has its own primary
`OpportunityContactRole`, so both one-to-one and one-to-many relationships can
be exercised. The records, contacts, products, price-book entries and quote
lines are identified by stable `QuoteWake Demo - ` names and are created or
updated idempotently. For existing Quotes, `--seed-data` updates only their
structural/commercial fields and preserves all six QuoteWake progress fields;
use `--reset-data` when that progress should be cleared. The seed does not
delete existing Salesforce records.

To start a clean QuoteWake data run, seed the hierarchy, delete only Tasks whose
`WhatId` points to a Quote with that stable demo prefix, and reset all ten demo
Quotes to `QuoteWake_Enabled__c=true`, blank follow-up status/timestamps/results,
and `Attempt_Count__c=0`:

```bash
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --reset-data
```

`--reset-data` implies `--seed-data`. It never deletes demo Accounts,
Opportunities, Quotes, Contacts, Products, price-book entries, or quote lines;
it only deletes the scoped Tasks and resets the six QuoteWake state fields.

The script is safe to run repeatedly. It enables standard Quotes through `QuoteSettings`, deploys six fields on `Quote`, deploys the minimal `QuoteWake_User` permission set, and validates the result. Permission-set assignment is explicit:

```bash
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --assign-permissions
```

The optional seed command discovers required standard fields and the standard Price Book dynamically. It also creates fictional `Product2`, `PricebookEntry`, and `QuoteLineItem` records so each demo Quote has visible concepts, quantities, unit prices, and calculated totals. Salesforce uses `Presented` as the standard quote status equivalent to sent; the kitchen and EV demos use that status and are due for QuoteWake follow-up.

## Salesforce dry-run

Run the read-only quote selection layer:

```bash
python3 -m quotewake_salesforce --dry-run --target-org quotewake-dev
```

The command verifies the target org, describes the required objects, runs the
Quote and `OpportunityContactRole` SOQL queries, and evaluates the rules in
Python. It writes one JSON object per line to
`results/quotewake_salesforce_dry_run.jsonl` by default.

Selection reports use JSONL schema version 2, recorded as
`report_schema_version: 2` (`schema_version: 2` remains as a compatibility
alias). The legacy numeric `amount` and
`currency_code` keys remain for consumers that have not migrated, while the
`money` object carries the exact decimal value as text plus its Salesforce
source field and scale. This avoids binary floating-point rounding in local
reports. Human-readable totals, dates, and CALL-E context use the configured
CLDR locale and business timezone from `[regional]` in `quotewake.toml`:

```toml
[regional]
business_timezone = "Europe/Madrid"
locale = "es_ES"
```

The timezone and locale are explicit configuration; they are never inferred
from a phone number or the machine running QuoteWake. Expiration and due-soon
date rules, as well as Salesforce Task `ActivityDate`, use the configured
business timezone. Locale values may use CLDR (`en_US`) or BCP-47 (`en-US`)
syntax. If a BCP-47 Unicode extension such as `-u-ca-gregory` is supplied,
QuoteWake validates and formats with its base locale because Babel does not
currently preserve that extension in formatter locale identifiers.

## CALL-E planning dry-run

Authenticate the official CLI once if needed:

```bash
calle auth login
```

Generate CALL-E plans for the selected records without starting calls:

```bash
python3 -m quotewake_salesforce \
  --dry-run \
  --plan-calls \
  --target-org quotewake-dev \
  --call-language Spanish \
  --call-region ES
```

Language and region are mandatory and are never inferred from the phone number.
The command checks `calle auth status`, loads Quote line items only for `READY`
records, and invokes the `plan_call` MCP tool through the official CLI. It does
not invoke `run_call` or `get_call_run`.

Planning results are written to
`results/quotewake_salesforce_call_plans.jsonl`. Each record contains the Quote,
Opportunity and Contact identifiers, a masked phone, `PLAN_READY`,
`PLAN_INCOMPLETE`, or `PLAN_ERROR`, the plan identifier, confirmation summary,
and clarification questions. Confirmation tokens and OAuth credentials are
never persisted. One planning failure is recorded without preventing later
`READY` Quotes from being planned; the command exits non-zero if any plan failed.

`plan_call` creates a remote CALL-E plan record, but it does not contact the
recipient. Omit `--plan-calls` for a Salesforce-only dry-run with no CALL-E
interaction.

The default allowed commercial status is `Presented`, based on the status
picklist discovered in the current Developer Org. Configure a different policy
without changing code, for example:

```bash
python3 -m quotewake_salesforce \
  --dry-run \
  --target-org quotewake-dev \
  --allowed-quote-status Presented \
  --allowed-quote-status Approved
```

Initial follow-up timing is configured in `quotewake.toml`:

```toml
[selection.initial_follow_up]
minimum_delay_hours = 4
standard_delay_hours = 48
due_soon_window_days = 3
```

Use `--config /path/to/quotewake.toml` to load another configuration. Values
must be non-negative and the standard delay cannot be shorter than the minimum
delay.

`READY` means the Quote is enabled and has either a blank or `Retry`
`Follow_Up_Status__c`, is below `MAX_ATTEMPTS = 3`, unexpired, linked to an
open Opportunity, in an allowed commercial status, and has exactly one primary
Opportunity Contact Role with permission to call and a valid phone number. A
blank follow-up status represents the initial follow-up and ignores
`Next_Follow_Up_At__c`. Salesforce does not expose a standard sent timestamp in
this org, so QuoteWake conservatively uses `LastModifiedDate` as its initial
reference. It always waits the configured minimum delay. After that, the Quote
is eligible once the standard delay has passed or its `ExpirationDate` is
within the configured due-soon window. `Retry` is eligible only when
`Next_Follow_Up_At__c` exists and is due; initial timing is not reapplied.
`In Progress` represents an active call, while `Completed` and `Stopped` are
terminal states. Other results are `SKIP` with a
machine-readable reason such as `NOT_DUE`, `MAX_ATTEMPTS`,
`NON_ACTIONABLE_FOLLOW_UP_STATUS`, `NO_PRIMARY_CONTACT`, `DO_NOT_CALL`, or
`NO_PHONE`. `Completed` and `Stopped` are valid terminal statuses, so they are
not eligible for another call; an unknown picklist value is reported as
`INVALID_FOLLOW_UP_STATUS`.

Contact opt-out filtering is optional because Salesforce orgs may not expose a
standard `Contact.DoNotCall` field. Without `--do-not-call-field`, QuoteWake
does not query an opt-out field, continues normal Contact validation, and emits
a warning that opt-out filtering is disabled. If the org uses a customer-specific
boolean field, pass its API name; QuoteWake verifies that it exists before
querying it:

```bash
python3 -m quotewake_salesforce \
  --dry-run \
  --target-org quotewake-dev \
  --do-not-call-field Do_Not_Call__c
```

Verify the field first with `sf sobject describe --sobject Contact`.

## Verify Quotes

After setup, the full demo query can be run directly with Salesforce CLI:

```bash
sf data query \
  --target-org quotewake-dev \
  --query "SELECT Id, Name, OpportunityId, LastModifiedDate, ExpirationDate, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c FROM Quote ORDER BY CreatedDate DESC"
```

An equivalent SOQL pre-filter for the default timing configuration is:

```sql
SELECT Id, Name, OpportunityId, LastModifiedDate, ExpirationDate,
       QuoteWake_Enabled__c,
       Follow_Up_Status__c, Next_Follow_Up_At__c,
       Attempt_Count__c, Last_Follow_Up_At__c,
       Last_Follow_Up_Result__c
FROM Quote
WHERE QuoteWake_Enabled__c = true
  AND Status = 'Presented'
  AND Opportunity.IsClosed = false
  AND (ExpirationDate = null OR ExpirationDate >= 2026-08-09)
  AND (Attempt_Count__c = null OR Attempt_Count__c < 3)
  AND (
    (
      Follow_Up_Status__c = null
      AND (
        LastModifiedDate <= 2026-08-07T17:30:00Z
        OR (
          LastModifiedDate <= 2026-08-09T13:30:00Z
          AND ExpirationDate != null
          AND ExpirationDate <= 2026-08-12
        )
      )
    )
    OR (
      Follow_Up_Status__c = 'Retry'
      AND Next_Follow_Up_At__c != null
      AND Next_Follow_Up_At__c <= 2026-08-09T17:30:00Z
    )
  )
ORDER BY Next_Follow_Up_At__c ASC NULLS FIRST, LastModifiedDate ASC
```

The Date and DateTime literals above are examples. The application currently
loads candidate Quotes and evaluates these rules in Python using the current
UTC time and values loaded from `quotewake.toml`.

## CALL-E simulation for Spain

CALL-E calls are not currently available for region `ES`. QuoteWake therefore
provides an explicit, deterministic simulator that exercises the same context,
result parsing, and Salesforce write-back path without invoking CALL-E. It is
restricted to seeded Quotes whose name starts with `QuoteWake Demo - ` and
requires an explicit acknowledgement before writing.

```bash
python3 -m quotewake_salesforce \
  --simulate-call \
  --target-org quotewake-dev \
  --quote-id <QUOTE_ID> \
  --simulation-outcome interested \
  --call-language Spanish \
  --call-region ES \
  --confirm-demo-write
```

The supported outcomes are `interested`, `not_interested`, `call_back_later`,
`no_answer`, `busy`, `invalid_number`, and `error`. Retry outcomes require a
future timezone-aware `--next-follow-up-at`, for example
`2026-08-10T10:00:00Z`. The command updates the selected Quote and creates a
completed standard `Task` in one Salesforce Composite API request with
`allOrNone=true`. It never runs `calle`, `plan_call`, or `run_call`.

The redacted local report is written to
`results/quotewake_salesforce_simulations.jsonl` by default. It contains masked
phone data, the deterministic simulation ID, the structured result, and the
simulation timestamp and Salesforce Task ID; it does not contain a full phone number, transcript,
credentials, or tokens.

### CLI help and temporary timing configuration

The complete CLI reference is available with either of these commands:

```bash
python3 -m quotewake_salesforce --help
python3 -m quotewake_salesforce --simulate-call --help
```

Both forms show the legacy demo, Salesforce dry-run, CALL-E planning, simulator
options, and the temporary configuration helper.

The default timing configuration waits 4 hours minimum and 48 hours before an
initial Quote becomes `READY`. For a one-off demo, provide a temporary TOML
configuration through `/dev/stdin`; this does not modify the repository:

```bash
printf '%s\n' \\
  '[regional]' \\
  'business_timezone = "Europe/Madrid"' \\
  'locale = "es_ES"' \\
  '' \\
  '[selection.initial_follow_up]' \\
  'minimum_delay_hours = 0' \\
  'standard_delay_hours = 0' \\
  'due_soon_window_days = 0' |
python3 -m quotewake_salesforce \\
  --simulate-call \\
  --target-org quotewake-dev \\
  --quote-id <QUOTE_ID> \\
  --simulation-outcome interested \\
  --call-language Spanish \\
  --call-region ES \\
  --confirm-demo-write \\
  --config /dev/stdin
```

This temporary configuration only changes eligibility timing for that command;
the simulator still requires a seeded `QuoteWake Demo - ...` Quote, a callable
Contact, and the explicit `--confirm-demo-write` acknowledgement.

## Opt-in Salesforce E2E verification

`test_e2e_salesforce.py` is a manual runner and is intentionally outside
`tests/`, so normal unit-test discovery never writes to Salesforce. It requires
an explicit target org and confirmation, and refuses production-style orgs:
only Developer Edition and Sandbox orgs are accepted.

After deploying metadata and seeding the ten-Quote demo dataset, run:

```bash
python3 test_e2e_salesforce.py \
  --target-org quotewake-dev \
  --confirm-demo-write
```

The runner resolves the Kitchen, EV Charger, and Office Quotes by name and
resolves each primary Contact through its Opportunity relationship; it never
uses hard-coded Salesforce IDs. Immediately before each scenario it resets
only the six QuoteWake fields, then invokes the existing simulator CLI with a
temporary zero-delay configuration. The matrix is:

| Fixture | Simulated outcome | Expected Quote status |
| --- | --- | --- |
| Kitchen Electrical Renovation | `interested` | `Completed` |
| EV Charger Installation | `call_back_later` | `Retry` |
| Office Electrical Upgrade | `invalid_number` | `Stopped` |

The runner verifies the resulting Quote fields, commercial-field invariants,
the created Task and its Quote/Contact relationships. It does not delete or
clean up Quotes or Tasks. A redacted summary is written to
`results/quotewake_salesforce_e2e.json` (override with `--output`); it contains
masked phones, simulation timestamps, outcomes and IDs, but no full phone
numbers, credentials or transcripts. This runner is not executed by the normal
test suite and does not place real calls.

## Tests

The unit and fake-CLI integration tests do not require Salesforce or CALL-E:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

The normal selection and planning paths remain read-only. The simulator uses
only its scoped Composite API Quote + Task write, while the CALL-E adapter
exposes planning only and has no call execution method.
