# QuoteWake

QuoteWake is a Salesforce-first back-office process for following up commercial
Quotes by phone. It helps a sales team turn the Salesforce quote pipeline into
an orderly, auditable follow-up queue while keeping Salesforce as the workflow,
user-interface, and system of record.

QuoteWake selects eligible Quotes, resolves the related Opportunity, Account,
and Contact, prepares a focused CALL-E call context, classifies the result, and
writes the outcome back to the Quote. A standard Salesforce Task records the
activity so a seller can see what happened alongside the rest of the sales
workflow.

## Workflow

1. Read Salesforce `Quote` records and their related open `Opportunity`.
2. Apply configured eligibility rules for Quote status, expiration, follow-up
   state, attempt count, cooldown, and (when enabled) calling days and hours.
3. Resolve exactly one primary `OpportunityContactRole` and validate opt-out and
   phone availability.
4. Load concise quote-line context and prepare a bounded CALL-E plan.
5. Classify the structured call result as a business outcome or technical
   failure.
6. Persist the outcome, next follow-up time, attempt count, and a standard
   Salesforce Task atomically.

Retry, cooldown, and calling-hours policies are application configuration. No
external database or `Max_Attempts__c` field is used.

## Product capabilities

QuoteWake provides the operational controls a sales team needs for dependable
quote follow-up:

- Eligibility filters prevent calls for disabled, expired, closed, invalid, or
  commercially ineligible Quotes and require a single callable primary Contact.
- Retry limits and delays are configurable. The maximum includes the first
  business call; `NO_ANSWER` and other configured retry outcomes schedule the
  next follow-up without embedding a fixed cadence in code.
- A per-Quote cooldown prevents the same customer Quote from being called too
  frequently.
- Calling days and hours are opt-in. When enabled, the configured regional IANA
  timezone determines local windows, including daylight-saving transitions.
  When disabled, QuoteWake does not restrict call timing.
- Technical CALL-E failures are recorded and retried without consuming a
  business attempt. A `NO_ANSWER` is a business outcome and does consume one.
- Dry-run selection, CALL-E planning, and the deterministic Salesforce
  simulation provide safe demonstrations without placing a real call.
- Structured outcomes update `Attempt_Count__c`, `Last_Follow_Up_At__c`,
  `Last_Follow_Up_Result__c`, `Follow_Up_Status__c`, and
  `Next_Follow_Up_At__c`; the accompanying standard Task gives users a visible
  audit trail.

The current repository does not yet invoke CALL-E `run_call`. Planning and the
explicit simulator exercise the same domain result and Salesforce write-back
boundaries, so live execution can be added without moving business rules into
the CLI or Salesforce client.

## Security and operational safety

Salesforce remains authoritative; QuoteWake does not create a second database
of commercial records. Salesforce authentication and CALL-E credentials stay
in their respective CLI/environment mechanisms. Normal tests use mocks and
deterministic results rather than external calls. The application emits
structured, redacted logs and avoids writing credentials, access tokens, raw
provider payloads, or unmasked customer phone numbers to reports.

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
Python. It prints the human-readable selection and planning outcomes; it does
not create local result reports. Human-readable totals, dates, and CALL-E context use the configured
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

QuoteWake also emits production-oriented, readable application logs as one
event per line to stderr and to `logs/quotewake.log` by default, in the form
`<timestamp> [<LEVEL>] <event>: <readable English text>`. Every run has
a `run_id`, and Quote processing and CALL-E events include the related
`quote_id`. Tokens, credentials, and raw request/response fields are never
logged; authorized phone values are retained for operational correlation. The
rotating file location, format, level and retention are configured in the
`[logging]` section of `quotewake.toml`:

```toml
[logging]
directory = "logs" # relative to the QuoteWake application directory
format = "text"
level = "INFO"
max_bytes = 5242880
backup_count = 5
```

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

Planning outcomes are printed for each `READY` Quote. Confirmation tokens and
OAuth credentials are never persisted. One planning failure is reported without
preventing later `READY` Quotes from being planned; the command exits non-zero
if any plan failed.

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

The three follow-up policy tables are required in the same TOML file. The
maximum includes the first call, so `retry_delays_days` has exactly
`max_attempts - 1` entries:

```toml
[follow_up.retry]
max_attempts = 3
retry_delays_days = [2, 4]
retry_outcomes = ["call_back_later", "no_answer", "busy"]
technical_failure_retry_delay_minutes = 30
completed_outcomes = ["interested"]

[follow_up.cooldown]
enabled = true
minimum_delay_hours = 24

[follow_up.calling_hours]
enabled = false
days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
start = "09:00"
end = "18:00"
```

Cooldown is evaluated per Quote using `Last_Follow_Up_At__c`. Calling hours,
when enabled, use the configured `regional.business_timezone` for weekday and
local time; Salesforce DateTimes remain UTC. The end time is exclusive. When
disabled, calling hours do not restrict call eligibility.

`READY` means the Quote is enabled and has either a blank or `Retry`
`Follow_Up_Status__c`, is below the configured maximum attempts, unexpired, linked to an
open Opportunity, in an allowed commercial status, and has exactly one primary
Opportunity Contact Role with permission to call and a valid phone number. A
blank follow-up status represents the initial follow-up and ignores
`Next_Follow_Up_At__c`. Salesforce does not expose a standard sent timestamp in
this org, so QuoteWake conservatively uses `LastModifiedDate` as its initial
reference. It always waits the configured minimum delay. After that, the Quote
is eligible once the standard delay has passed or its `ExpirationDate` is
within the configured due-soon window. `Retry` is eligible only when
`Next_Follow_Up_At__c` exists and is due and the cooldown has elapsed; initial
timing is not reapplied. If calling hours are enabled, the current time must
also be inside the configured window.
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

An equivalent SOQL pre-filter for the production-style 4-hour/48-hour timing
example is:

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
`no_answer`, `busy`, `invalid_number`, and `error`. `NO_ANSWER` and other
configured business retry outcomes use the configured retry delays.
`--next-follow-up-at` is optional and represents a customer-requested future
time for `call_back_later`, for example `2026-08-10T10:00:00Z`. The command updates the selected Quote and creates a
completed standard `Task` in one Salesforce Composite API request with
`allOrNone=true`. It never runs `calle`, `plan_call`, or `run_call`.

The simulator prints the outcome and created Salesforce Task ID and writes the
structured result only to Salesforce. It does not create a local report.

### CLI help and temporary timing configuration

The complete CLI reference is available with either of these commands:

```bash
python3 -m quotewake_salesforce --help
python3 -m quotewake_salesforce --simulate-call --help
```

Both forms show the Salesforce dry-run, CALL-E planning, simulator options, and
the temporary configuration helper.

The shipped demo configuration uses zero-hour initial timing so seeded Quotes
can be exercised immediately. A production-style configuration can use, for
example, a 4-hour minimum and a 48-hour standard delay. For a one-off demo or
timing override, provide a temporary TOML configuration through `/dev/stdin`;
this does not modify the repository:

```bash
printf '%s\n' \\
  '[regional]' \\
  'business_timezone = "Europe/Madrid"' \\
  'locale = "es_ES"' \\
  '' \\
  '[selection.initial_follow_up]' \\
  'minimum_delay_hours = 0' \\
  'standard_delay_hours = 0' \\
  'due_soon_window_days = 0' \\
  '' \\
  '[follow_up.retry]' \\
  'max_attempts = 3' \\
  'retry_delays_days = [2, 4]' \\
  'retry_outcomes = ["call_back_later", "no_answer", "busy"]' \\
  'technical_failure_retry_delay_minutes = 30' \\
  'completed_outcomes = ["interested"]' \\
  '' \\
  '[follow_up.cooldown]' \\
  'enabled = true' \\
  'minimum_delay_hours = 24' \\
  '' \\
  '[follow_up.calling_hours]' \\
  'enabled = false' \\
  'days = ["monday", "tuesday", "wednesday", "thursday", "friday"]' \\
  'start = "09:00"' \\
  'end = "18:00"' |
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
and the created Task and its Quote/Contact relationships. It does not delete or
clean up Quotes or Tasks, and it does not create files under the application
`results` directory. This runner is not executed by the normal test suite and
does not place real calls.

## Tests

The unit and fake-CLI integration tests do not require Salesforce or CALL-E:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

The normal selection and planning paths remain read-only. The simulator uses
only its scoped Composite API Quote + Task write, while the CALL-E adapter
exposes planning only and has no call execution method.
