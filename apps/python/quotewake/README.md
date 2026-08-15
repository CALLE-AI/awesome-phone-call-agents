# QuoteWake

QuoteWake turns eligible Salesforce Quotes into structured follow-up calls.
It selects the next Quotes due for attention, gives CALL-E the relevant
commercial context, and writes each accepted call outcome back to Salesforce.
Salesforce remains the system of record, so sellers can see follow-up status,
attempt history, and next actions where they already manage the sales process.

## Product demo

[📹 Watch the QuoteWake teaser](media/teaser.mp4)

## Who it is for

QuoteWake is for any sales or commercial team that manages Quotes, Accounts,
Opportunities, and Contacts in Salesforce and wants consistent phone follow-up
with outcomes recorded for the next seller action.

## Workflow

```text
Salesforce Quotes
      │ eligible Quote and customer context
      ▼
QuoteWake ── prioritize, prepare, enforce policy ───┐
      │                                               │
      └──────── CALL-E dry-run or outbound call ◄─────┘
                              │ structured result
                              ▼
              Salesforce Quote + completed Task
```

For each run, QuoteWake:

1. Finds Salesforce Quotes that are due and eligible for follow-up.
2. Resolves the customer, primary contact, products, locale, and call policy.
3. Lets an operator preview the planned call or asks CALL-E to place it.
4. Converts the accepted call result into a clear commercial outcome.
5. Updates the Quote and creates a completed Salesforce Task with the summary
   and next action.

## What QuoteWake delivers

- **Consistent follow-up:** eligibility, retry, attempt-limit, and opt-out checks
  are applied before each planned call.
- **Useful call context:** CALL-E receives the Quote, customer, primary contact,
  products, locale, and regional context needed for the conversation.
- **Safe operator control:** dry-run and prompt-preview modes show what would
  happen before any outbound call or Salesforce write.
- **Actionable Salesforce history:** accepted calls update follow-up state and
  create a completed Task with the outcome, summary, next action, and call ID.
- **Deterministic recovery:** machine-readable busy, no-answer, rejection, and
  error states follow explicit retry and human-review rules.
- **Operational visibility:** bounded rotating logs, a per-run call summary,
  deterministic idempotency, and `--max-calls` support controlled execution.

## Run QuoteWake manually

Run these modes in order when validating a setup:

1. **Dry-run first** — authenticates to Salesforce, evaluates Quotes, and shows
   the calls that would be selected. It does not construct the CALL-E provider
   SDK client, make CALL-E network requests, place a call, or write Salesforce.

   ```shell
   uv run python -m quotewake_salesforce --max-calls 1
   ```

2. **Preview the prompt** — performs the same read-only selection and prints the
   Salesforce-derived prompt for review. It does not place a call or write
   Salesforce; protect the output because it contains commercial context.

   ```shell
   uv run python -m quotewake_salesforce --show-prompt --max-calls 1
   ```

3. **Execute only after both checks** — places up to one CALL-E call and, when
   an accepted result is available, atomically updates the Quote and creates a
   completed Task.

   ```shell
   uv run python -m quotewake_salesforce --execute --max-calls 1
   ```

Increase `--max-calls` only after confirming selection, permissions, recipient
authorization, operating hours, and CALL-E behavior. The onboarding below
contains the full setup and pre-live checklist.

## How QuoteWake selects Quotes

The Salesforce query provides a stable `LastModifiedDate ASC, Id ASC` stream.
Before applying `--max-calls`,
READY Quotes are ordered by the oldest actionable follow-up timestamp: a due
`Retry` uses `Next_Follow_Up_At__c`, while an initial follow-up uses
`LastModifiedDate`. Ties use `LastModifiedDate` and Quote ID. It does not score
or rank candidates by account value, Quote amount, engagement, or any other
priority signal. `--max-calls` takes the first READY candidates in this
follow-up-age order (default: `10`) in both dry-run and execute modes. It is a
throughput limit, not a concurrency lock.

By default, a Quote is READY when it is enabled, has status `Presented`, belongs
to an open Opportunity, is not expired, is below the configured maximum of three
accepted call attempts, and has either a blank follow-up status or a due `Retry`
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
- `Attempt_Count__c`: accepted CALL-E attempts. Failures before CALL-E returns a
  `call_id` do not consume one; every accepted call consumes one. Reliable
  terminal non-connection states use retryable `call_not_established`, while
  wait/parse errors without a reliable terminal state use `unknown`.

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
has an accepted call that it can safely persist. Reliable terminal provider
failures create a retryable `call_not_established` Task without a human-review
marker; wait/parse errors without a reliable terminal state create an `unknown`
human-review Task. Create failures without a confirmed `call_id` do not update
Salesforce or create a Task.

## Beginner onboarding: Salesforce to a safe dry-run

Start with an available Salesforce Sales org. Use a sandbox, Developer Edition,
or other non-production org for your first setup. Metadata deployment, demo
seeding, and reset operations change Salesforce data; do not experiment in a
production org. Salesforce also recommends a sandbox for API testing.

Choose one data path before starting:

- **Path A — demo data:** deploy QuoteWake metadata, then let the setup script
  create its named demo Accounts, Contacts, Opportunities, Quotes, products,
  and quote lines. This is the fastest path for a disposable org.
- **Path B — existing data:** deploy metadata only, then enable and prepare
  existing Quotes yourself. The setup script does not need to seed records.

The steps through the first dry-run are common to both paths.

### 1. Understand the two Salesforce identities

Use two separate identities:

| Identity | Used by | Purpose |
| --- | --- | --- |
| Admin CLI login | `sf` and `scripts/setup-salesforce.sh` | Enable/deploy setup and inspect the org. This browser login is not used by QuoteWake at runtime. |
| Dedicated runtime user | External Client App **Run As** | Owns every runtime API request. Its permissions and record sharing define exactly what QuoteWake can read and write. |

Do not configure the External Client App to run as your administrator. The
[Salesforce client-credentials guidance](https://help.salesforce.com/s/articleView?id=sf.configure_client_credentials_flow_for_external_client_apps.htm&language=en_US&type=5)
requires an integration user and warns that anyone holding the consumer key and
secret can request a token as that user.

### 2. Install the local tools and project

You need Python 3.11 or newer, [`uv`](https://docs.astral.sh/uv/), the
[Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli), and
`jq`. From this QuoteWake directory:

```shell
sf --version
jq --version
uv sync
cp .env.example .env
chmod 600 .env
```

Keep `.env` private. Never commit credentials, access tokens, or real customer
phone data.

### 3. Log in to Salesforce as an administrator

Use the command for your org type. For a production or Developer Edition org,
start from the standard Salesforce login URL:

```shell
sf org login web \
  --instance-url https://login.salesforce.com \
  --alias quotewake-admin \
  --set-default
```

For a sandbox, use that sandbox's My Domain URL instead. Obtain it by signing in
to the sandbox in a browser and copying its URL origin, or ask the Salesforce
administrator for the sandbox My Domain URL. Replace `MyDomainName` and
`SandboxName` below with those org-specific values; do not reuse another org's
hostname:

```shell
export QUOTEWAKE_SANDBOX_URL="https://MyDomainName--SandboxName.sandbox.my.salesforce.com"
sf org login web \
  --instance-url "$QUOTEWAKE_SANDBOX_URL" \
  --alias quotewake-admin \
  --set-default
```

After either login, verify the selected org:

```shell
sf org display --target-org quotewake-admin
```

The browser login authorizes administrative CLI operations only. It does not
populate `.env` and does not authenticate the QuoteWake Python process. See the
official [`sf org login web` reference](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_org_login_web.html).

### 4. Enable standard Quotes manually

This is currently a prerequisite to the script: in Salesforce Setup, enter
`Quote` in **Quick Find**, select **Quote Settings**, select **Enable Quotes**,
and save. Do this manually before running the script because the current setup
cannot reliably enable Quotes in every Sales org through metadata. The
[Salesforce Quote setup guide](https://help.salesforce.com/s/articleView?id=sf.quotes_enable.htm&language=en_US&type=5)
documents the same controls. QuoteWake requires Quotes related to Opportunities;
it does not require the optional setting for Quotes without an Opportunity.

### 5. Deploy QuoteWake metadata without seeding data

Run the setup script with no data option. It deploys the Quote and Contact
fields plus `QuoteWake_User`, verifies the schema, and does not create demo
business records:

```shell
./scripts/setup-salesforce.sh --target-org quotewake-admin
```

This deployment is separate from choosing Path A or Path B below. Do not add
`--seed-data` yet.

### 6. Create the dedicated jury user

Use the administrator CLI target to run the idempotent provisioning script. It
only supports a Developer Edition or sandbox and performs all read-only checks
(authentication, org type, profile, Salesforce license availability, QuoteWake
schema, existing-user conflicts, and permission-set metadata) before its first
write. Start with a dry-run:

```shell
./scripts/create-jury-user.sh \
  --target-org quotewake-admin \
  --email jury@example.com \
  --username quotewake.jury@example.com \
  --dry-run
```

After reviewing the output, run the same command without `--dry-run`:

```shell
./scripts/create-jury-user.sh \
  --target-org quotewake-admin \
  --email jury@example.com \
  --username quotewake.jury@example.com
```

The script deploys `QuoteWake_Jury_User`, creates the user with the
`Minimum Access - Salesforce` profile and the Salesforce user license, assigns
the permission set, and asks Salesforce to send the password-reset/welcome
email. It never generates, prints, stores, or accepts a password. If the
matching user already exists, it reuses it safely; a different email, username,
profile, or license is a hard conflict. Use `--resend-welcome` only when the
existing jury user needs another reset email.

`QuoteWake_Jury_User` is separate from the narrower `QuoteWake_User` runtime
permission set. It grants the jury API and Lightning Sales UI access needed to
inspect and edit the demo's commercial records while denying delete, View All,
and Modify All:

| Resource | Jury access |
| --- | --- |
| System | API enabled and Lightning Sales app visible. |
| `Account`, `Contact`, `Opportunity`, `Quote` | Read and edit selected commercial fields; create and delete denied. |
| `OpportunityContactRole` | Read relationship and primary-contact fields. |
| `QuoteLineItem` | Read and edit quantity, unit price, and description; create and delete denied. |
| `Product2` | Read product name and unit fields. |
| `Organization` | Read timezone, locale, and language settings. |
| `Task` | Create, read, and edit follow-up activities; delete denied. |
| UI tabs | Account, Contact, Opportunity, Quote, Product, and Task visible. |

The user still needs record sharing for the Accounts, Contacts,
Opportunities, Quotes, Opportunity Contact Roles, Quote Lines, and Products
that the jury should inspect. A permission set does not override sharing; use
org-wide defaults, sharing rules, teams, or explicit sharing to limit access to
the intended demo records.

The password-reset email contains the Salesforce UI sign-in path. The jury
should set a unique password and complete MFA before testing. The UI username
and password do not belong in `.env`.

### 7. Create the External Client App

Follow Salesforce's current
[External Client App client-credentials procedure](https://help.salesforce.com/s/articleView?id=sf.configure_client_credentials_flow_for_external_client_apps.htm&language=en_US&type=5):

1. In Setup, enter `External Client Apps Manager` in **Quick Find**, open it,
   and select **New External Client App**.
2. Enter a descriptive app name such as `QuoteWake Jury` and an administrator
   contact email. Keep this app separate from any existing administrator or
   developer integration app.
3. Under **API (Enable OAuth Settings)**, select **Enable OAuth**. If the form
   requires a callback URL, enter an HTTPS URL controlled by your organization;
   the client-credentials flow does not redirect to it.
4. Move **Manage user data via APIs (api)** into **Selected OAuth Scopes**. Do
   not add broader scopes that QuoteWake does not use.
5. Under flow enablement, select **Enable Client Credentials Flow**, acknowledge
   the security warning, and create/save the app.
6. Open the app's **Policies** tab, select **Edit**, set **Permitted Users** to
   **Admin approved users are pre-authorized**, and set **Run As** to the
   newly provisioned jury user. Save.
7. Open the app's OAuth settings and select **Consumer Key and Secret** (the UI
   can require identity verification). Store both values in a secret manager;
   never paste them into source control. Anyone holding these two values can
   obtain API tokens as the jury user, so share them only through a secret
   manager or an encrypted handoff.

All tokens from this flow inherit the Run As user's permissions and record
access. Salesforce can take several minutes to make a new app usable.

Get the org's My Domain URL from **Setup → My Domain**, or from the admin CLI:

```shell
sf org display --target-org quotewake-admin
```

Use the `https://<my-domain>.my.salesforce.com` instance URL, not a Lightning
UI URL and not a token endpoint path.

### 8. Configure `.env`

Fill the copy created earlier:

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

Leave `CALLE_API_KEY` as a placeholder for the first dry-run; it is required
only with `--execute`. Use an API version supported by the org. In a
single-currency org where `Quote.CurrencyIsoCode` is unavailable, set
`SALESFORCE_CURRENCY_CODE` to the org's three-letter ISO currency code.

### 9. Choose and prepare the data path

#### Path A — create disposable demo data

Seed the idempotent demo hierarchy after metadata and runtime access are ready:

```shell
./scripts/setup-salesforce.sh \
  --target-org quotewake-admin \
  --seed-data \
  --country-code US \
  --call-locale en_US
```

New demo Contacts receive fictional fixture numbers when `--test-phones` is
omitted. Existing demo `Phone` and `MobilePhone` values are preserved. Use
`--reset-data` only when intentionally starting a new demo generation: it
deletes Tasks linked to the demo Quotes, resets their QuoteWake state, and
changes the idempotency generation marker.

#### Path B — use existing Salesforce data

Do not run `--seed-data` or `--reset-data`. Prepare at least one existing Quote
and its relationships so that all of these are true:

- Quote status is `Presented` (or is included in
  `QUOTEWAKE_ALLOWED_QUOTE_STATUSES`), `QuoteWake_Enabled__c` is selected, the
  Quote is not expired, and its Opportunity is open.
- The Quote belongs to an Opportunity with an Account and exactly one primary
  Opportunity Contact Role.
- That primary Contact has an authorized test phone in `MobilePhone` or `Phone`
  and a supported `QuoteWake_Call_Locale__c` value.
- The Account has `BillingCountryCode`; the Quote has usable totals and quote
  lines; follow-up state is blank or a `Retry` is due.
- The runtime user has field and sharing access to the complete record graph.

### 10. Run the safe runtime test

The default command authenticates with the External Client App, reads
Salesforce, and previews selection. It does not construct the CALL-E provider
SDK client, make CALL-E network requests, place a call, or write Salesforce:

```shell
uv run python -m quotewake_salesforce --max-calls 1
```

A prepared record produces a `READY` Quote followed by a dry-run call preview.
If no record is eligible, the command reports no selected calls; that is a safe
result, not permission to switch to live mode. To inspect the rendered prompt
without calling or writing, run:

```shell
uv run python -m quotewake_salesforce --show-prompt --max-calls 1
```

### 11. Checklist before one live call

Before adding `--execute`, confirm every item:

- You are using a sandbox/non-production org and the intended Quote is the only
  selected READY record.
- The Contact explicitly uses a phone number you are authorized to call, in
  E.164 form, and applicable consent, calling-hour, and opt-out requirements
  have been checked.
- The runtime user is dedicated and least-privileged; sharing limits it to the
  intended records.
- `.env` has the correct My Domain, consumer key/secret, API version, and a valid
  `CALLE_API_KEY`; secrets and raw support logs are protected.
- The dry-run and `--show-prompt` output contain the expected customer, locale,
  Quote, and products.
- `--max-calls 1` is set and no scheduler or second worker is running.

Then place one call and persist its result:

```shell
uv run python -m quotewake_salesforce --execute --max-calls 1
```

After a safely persisted result, output resembles:

```text
Call results:
Quote 0Q0123456789ABC: Example Quote | $1,250.00 | CALLED (no_answer)
```

If this call consumes the configured final attempt for a retryable outcome,
the Quote becomes `Stopped` and its Task says exactly: `QuoteWake will make no
further attempts. A salesperson should call the customer directly.` QuoteWake
does not schedule another automated call. Before the limit, the Task preserves
the next action returned for the call and the Quote remains `Retry`.

`--idempotency-suffix` is a test/support escape hatch for intentionally starting
a new provider request with the same Quote and attempt data. Omit it in normal
runs. Use `--config /path/to/quotewake.toml` to select another TOML file; the
default is [`quotewake.toml`](quotewake.toml).

### Inspect or adjust QuoteWake state

```shell
./scripts/query-quotes.sh --target-org quotewake-admin
./scripts/update-quote.sh 0Q0123456789ABC --enabled true --attempt-count 1
./scripts/update-quote.sh 0Q0123456789ABC --retry-in 1d2h30m
./scripts/update-quote.sh 0Q0123456789ABC --clear-follow-up-status --clear-retry
```

The query script opens `less -S` on an interactive terminal; press `q` to exit.
The update script reads before and after changing only requested QuoteWake
fields. Its `--follow-up-status` values are `In Progress`, `Retry`, `Completed`,
and `Stopped`; retry durations use ordered `d`, `h`, `m`, and `s` components.

### Basic troubleshooting

| Symptom | Check |
| --- | --- |
| `Quote` is unavailable or metadata deployment fails | Enable Quotes manually first, confirm the admin CLI targets the intended org, then rerun metadata-only setup. |
| OAuth `invalid_client` or authentication failure | Recheck the My Domain host, consumer key/secret, enabled Client Credentials Flow, and wait a few minutes after app changes. Do not use the Lightning URL. |
| `INVALID_SESSION_ID` or insufficient access | Confirm the External Client App Run As user, API access, object/field permissions, and that `QuoteWake_User` plus the additional permissions are assigned to that user. |
| No READY Quotes | Check status, enablement, expiration, retry date/attempt count, open Opportunity, one primary contact, phone/locale, Account country, and runtime sharing. Use `scripts/query-quotes.sh` for state. |
| Query reports an inaccessible object or field | Add the missing least-privilege object/field permission to the runtime user; remember the included permission set is incomplete for related objects. |
| Dry-run succeeds but live mode fails | Verify `CALLE_API_KEY`, authorized E.164 recipient, CALL-E connectivity, and logs. Do not repeatedly recreate an accepted call. |

## Configuration and environment

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
retry_outcomes = ["call_back_later", "call_not_established", "no_answer", "busy"]
technical_failure_retry_delay = "30m"
completed_outcomes = ["interested"]

[call]
wait_timeout_seconds = 600
# Optional. The default prompt is used when this is omitted.
prompt = "Follow up quote {quote_name} with {contact_name} at {account_name}."

[logging]
directory = "logs"
format = "text"
level = "DEBUG"
max_bytes = 5242880
backup_count = 5
# Temporary, sensitive support diagnostics; enabled in this demo configuration.
raw_calle_api = true
```

`max_attempts` includes the first accepted call attempt, so
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
example, a terminal provider `failed` result finishes as soon as CALL-E reports
it rather than using the full 600-second limit. QuoteWake
keeps the official synchronous
`create` + `wait_for_result` flow and uses a two-second polling interval.

The shipped configuration uses `DEBUG`. At that level, the console shows the
main completed Salesforce and CALL-E operations plus QuoteWake lifecycle
events, together with bounded provider-boundary metadata. Lines use the form
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
keeping `logging.level = "DEBUG"`. The shipped demo configuration intentionally
does this so the CALL-E boundary is visible during a demonstration. QuoteWake
then emits clearly labelled
`call_e_raw_request` and `call_e_raw_response` events for CALL-E create and
wait operations. These payloads are recursively sanitized: recipient values
under `phone`/`phones` are intentionally preserved for support, while
phone-like values in free text and all credentials are redacted. HTTP
`Authorization`, API-key, and header fields are never logged. However, raw
support logs can preserve recipient phone values and structured business data;
protect `logs/quotewake.log`, do not enable this setting in production unless
specifically required, and turn it off afterwards. The code default remains
`false` even though the checked-in demo TOML enables it.

## Outcomes, retries, and write safety

CALL-E agent results use this explicit vocabulary and deterministic policy:

| Intent | Quote effect | Attempt consumed? | Next action |
| --- | --- | --- | --- |
| `interested` | Increment `Attempt_Count__c`; mark `Completed`. | Yes | No automated retry. |
| `call_back_later` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use a future requested date or configured delay before the limit; at the limit, stop automation and direct a salesperson to call. |
| `not_interested` | Increment the count; mark `Stopped`. | Yes | No automated retry. |
| `stop_quote_follow_up` | Increment the count; mark `Stopped`. | Yes | Stop this Quote's follow-up and record the request in a Task; no Contact update. |
| `unknown` | Increment the count; mark `Stopped`. | Yes | Create a human-review Task; do not infer an intention or redial automatically. |
| `no_answer` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use the configured delay before the limit; at the limit, stop automation and direct a salesperson to call. |
| `busy` | Increment the count; mark `Retry` until the maximum, then `Stopped`. | Yes | Use the configured delay before the limit; at the limit, stop automation and direct a salesperson to call. |

QuoteWake also uses the internal outcome `call_not_established` when CALL-E has
accepted a call but reports a terminal `failed`, `rejected`, `declined`,
`canceled`, or `cancelled` state without an explicit machine-readable
`no_answer`/`busy` signal. It is not exposed in the agent result schema. It
consumes an attempt, follows the configured retry delays until `max_attempts`,
then marks the Quote `Stopped`; its Task does not request human review. Like
every retryable outcome at the final attempt, its Task directs a salesperson to
call the customer directly instead of claiming that QuoteWake will retry.

Provider and boundary failures are handled according to whether CALL-E
accepted the call:

| Failure | Salesforce write | Attempt consumed? | Next action |
| --- | --- | --- | --- |
| Terminal CALL-E `failed`/`rejected`/`declined`/`canceled`/`cancelled` with a confirmed `call_id` and no explicit machine-readable `no_answer`/`busy` signal | Atomic Quote retry update plus Task with internal `call_not_established` outcome; `Stopped` at the maximum | Yes | Retry after the configured delay; no human review is requested. |
| The same terminal states with an explicit machine-readable `no_answer`/`busy` signal | Atomic Quote retry update plus Task | Yes | Follow the configured retry policy. Free-text `failure_message` is never used as a signal. |
| Create `auth`, `balance`, `rate`, `schema`, `recipient`, `policy`, deterministic `idempotency`, or `call_not_ready` rejection (HTTP 4xx) | No commercial write | No | Fix the reported code/reason before a deliberate retry; review CALL-E task and recipient readiness for `call_not_ready`. |
| Create `timeout`, `connection`, or `provider` failure without HTTP status or with HTTP 5xx | No commercial write | No | Creation may be unknown; reconcile first and, if replaying creation, reuse the exact same idempotency key. |
| Any wait failure after a confirmed `call_id`, including HTTP 4xx/5xx, timeout, or connection failure | Atomic Quote `Stopped` update plus human-review Task with `unknown` outcome | Yes | Review the accepted call and bounded diagnostic; do not replay creation or redial automatically. |
| Malformed structured result, unsupported outcome, or invalid `task_completed` type after a confirmed `call_id` | Atomic Quote `Stopped` update plus human-review Task with `unknown` outcome | Yes | Review the accepted call and bounded diagnostic; never guess a commercial outcome. |

CALL-E create failures are rejected and do not produce a Salesforce write when
there is no confirmed `call_id`. A create response without a confirmed call ID
is treated as indeterminate: reconcile or replay with the exact same
idempotency key and do not generate a new call attempt. Once CALL-E has
confirmed a `call_id`, reliable terminal non-connection states become the
internal `call_not_established` outcome. Wait failures and parse failures
without a reliable terminal state remain the safe `unknown` outcome and create
a human-review Task. Both paths preserve the call ID and count one attempt.
Diagnostics are limited to bounded machine classification/code/reason values;
raw provider prose is not used to infer an outcome.

The request sends the SDK's `phones`, `locale`, and `region` recipient fields.
The result schema uses enums for the agent outcome and interest level and
does not use a JSON union for `preferred_date`; that date is optional by
omission. The internal `call_not_established` outcome is deliberately absent
from this schema and rejected if an agent returns it. Commercial conversation
outcomes require an explicit JSON boolean
`task_completed: true`. The retryable dispositions `no_answer` and `busy` are
the deliberate exceptions: a valid aggregate structured result or an explicit
provider attempt signal is sufficient even when `task_completed` is false and
the terminal provider status is `failed`. This covers declined or unconnected
calls without mistaking provider processing completion for commercial success.
Other false, null, or missing task evidence becomes `unknown`, while malformed
task evidence after acceptance also becomes the safe `unknown` result. Root
aggregate `structured_result` takes precedence;
recipient and last-attempt results remain supported as fallbacks. QuoteWake
validates all locations before accepting a business result.

Each CALL-E request receives a deterministic idempotency key based on the Quote
ID and next attempt. A persisted `Next_Follow_Up_At__c` marker is incorporated
for pre-acceptance create reconciliation and for each reset demo generation.
An ambiguous create can be replayed only with the same key; after a `call_id` is
confirmed, QuoteWake persists the accepted call outcome and never replays
creation for a wait or parse problem. This protects the provider boundary;
Salesforce write-side deduplication beyond the transaction below is not
implemented.

The result is persisted with one `allOrNone=true` Composite API request that
updates the Quote and creates its completed Task together. If that persistence
fails after a call has returned, QuoteWake records only bounded identifiers,
stops the remaining calls in that run, and returns a non-zero exit status. The
standard Task is an audit trail, not a separate local database.

## Scheduler and operations

QuoteWake performs one bounded batch and exits, which makes it suitable for
cron at the hours when calls are desired and permitted. It is not intended to
run continuously. QuoteWake does **not** enforce calling windows itself: the
scheduler, deployment owner, and applicable consent/compliance process must
ensure that calls happen only at allowed local times.

Use absolute paths because cron can have a restricted `PATH` and a different
working directory. The examples below assume the project is installed at
`/opt/quotewake`, `command -v uv` returned `/usr/local/bin/uv`, and the crontab
belongs to an operating-system user named `quotewake`. Prepare user-writable
runtime directories once as an administrator:

```shell
sudo install -d -o quotewake -g quotewake \
  /opt/quotewake/run \
  /opt/quotewake/logs
```

If the service account or `uv` location differs, replace those example values.
Do not grant the service account write access to more of `/opt` than it needs.
Use `flock` so runs using the same lock do not overlap. The following
user-crontab example runs hourly on weekdays from 09:00 through 17:00 in Madrid
and processes at most three Quotes per run:

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CRON_TZ=Europe/Madrid
0 9-17 * * 1-5 /usr/bin/flock -n /opt/quotewake/run/madrid.lock /usr/local/bin/uv run --project /opt/quotewake --directory /opt/quotewake --frozen python -m quotewake_salesforce --execute --max-calls 3 --config /opt/quotewake/quotewake.toml >> /opt/quotewake/logs/madrid.log 2>&1
```

For a separate New York operating window, use a separate entry and lock. This
example runs at 08:30 through 16:30 on weekdays and processes at most two Quotes
per run:

```cron
CRON_TZ=America/New_York
30 8-16 * * 1-5 /usr/bin/flock -n /opt/quotewake/run/new-york.lock /usr/local/bin/uv run --project /opt/quotewake --directory /opt/quotewake --frozen python -m quotewake_salesforce --execute --max-calls 2 --config /opt/quotewake/quotewake.toml >> /opt/quotewake/logs/new-york.log 2>&1
```

`CRON_TZ` support and daylight-saving behavior depend on the installed cron
implementation; verify both on the host. If `CRON_TZ` is unavailable, convert
the schedule using the daemon's timezone or use a scheduler with explicit IANA
timezone support. Multiple regions need separate schedules and a data-selection
rule that prevents the wrong regional cohort from being called; QuoteWake does
not currently segment candidates by timezone or territory.

Confirm the absolute paths with `command -v flock` and `command -v uv`. Using
both `--project /opt/quotewake` and `--directory /opt/quotewake` makes project
discovery, `.env` loading, and relative application paths independent of cron's
starting directory. Ensure the cron user can read `.env` and the TOML and can
write the prepared lock/log directories. The lock prevents overlap on one host
only; it is not a distributed lock, capacity reservation, per-customer lock, or
provider rate limiter. Set `--max-calls` to a batch size that fits the permitted
window and operational capacity.

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
redacted in normal events and error logs use exception types and bounded
reasons. The **code default** for raw CALL-E payload logging is `false`, but the
checked-in demo [`quotewake.toml`](quotewake.toml) explicitly sets
`logging.raw_calle_api = true`. Change it to `false` outside a temporary support
or controlled demonstration session. `--show-prompt` intentionally prints
Salesforce-derived business context, so treat its output and the rotating
`logs/quotewake.log` file as business data and protect them accordingly.

## Current limitations

- Candidate priority is oldest actionable follow-up date, with stable date/ID
  tie-breakers; there is no scoring or ranking by customer value, Quote amount,
  engagement, territory, consent, or capacity.
- Exactly one primary Opportunity Contact Role is required. There is no contact
  fallback, contact rotation, or multi-contact campaign.
- Completed standard Tasks provide history, but there is no local database,
  custom call-history object, Salesforce-side write deduplication ledger, or
  analytics/ROI model.
- The live path depends on CALL-E availability and credentials. Normal tests use
  mocks and do not place calls or contact Salesforce.
- QuoteWake currently does not add Salesforce Flow, Platform Events, Change Data
  Capture, Agentforce, or Apex automation, and is not a Salesforce-native
  package.

## Possible extensions

Future work can be selected from demonstrated operating needs: richer Quote
priority signals, territory and calling-time policy, consent and suppression
workflows, distributed coordination, provider rate controls, Salesforce-backed
reporting, or Salesforce-native automation where it adds a clear workflow
benefit.

## Tests

Unit and integration-boundary tests use mocks; they do not place real calls or
contact Salesforce:

```shell
uv run pytest
uv lock --check
git diff --check
```
