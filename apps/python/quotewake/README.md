# QuoteWake

QuoteWake turns eligible Salesforce Quotes into structured follow-up calls.
It selects the next Quotes due for attention, gives CALL-E the relevant
commercial context, and writes each accepted call outcome back to Salesforce.
Salesforce remains the system of record, so sellers can see follow-up status,
attempt history, and next actions where they already manage the sales process.

## Product demo

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
2. Resolves the customer, primary contact, locale, call policy, and product
   lines when the runtime user can access them.
3. Converts the accepted call result into a clear commercial outcome.
4. Updates the Quote and creates a completed Salesforce Task with the summary
   and next action.

## What QuoteWake delivers

- **Consistent follow-up:** eligibility, retry, attempt-limit, and opt-out checks
  are applied before each planned call.
- **Useful call context:** CALL-E receives the Quote, customer, primary contact,
  locale, regional context, and any accessible product lines needed for the
  conversation.
- **Safe operator control:** dry-run and prompt-preview modes show what would
  happen before any outbound call or Salesforce write.
- **Actionable Salesforce history:** accepted calls update follow-up state and
  create a completed Task with the outcome, summary, next action, and call ID.
- **Deterministic recovery:** machine-readable busy, no-answer, rejection, and
  error states follow explicit retry and human-review rules.
- **Operational visibility:** bounded rotating logs, a per-run call summary,
  deterministic idempotency, and `--max-calls` support controlled execution.

For details on how QuoteWake selects Quotes and on the Salesforce model, see
the [Salesforce integration documentation](doc/salesforce-integration.md).

## Onboarding

Start with an available Salesforce Sales org. Use a sandbox, Developer Edition,
or other non-production org for your first setup. Metadata deployment, demo
seeding, and reset operations change Salesforce data; do not experiment in a
production org. Salesforce also recommends a sandbox for API testing.

The setup script provides a complete demo dataset, including Accounts, Contacts,
Opportunities, Quotes, products, and quote lines. This is the recommended path
for testing QuoteWake quickly in a disposable org.

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
`jq`. The commands below target Debian, Ubuntu, and WSL. For macOS or Windows,
use the installers linked from the official tool pages.

Install the operating-system packages first:

```shell
sudo apt-get update
sudo apt-get install -y python3 python3-venv curl jq
```

Confirm that Python meets the project requirement:

```shell
python3 --version
```

Install `uv` with its official installer, then open a new terminal if the
installer asks you to update your `PATH`:

```shell
curl -LsSf https://astral.sh/uv/install.sh | sh
uv --version
```

Install the Salesforce CLI. The npm installation requires a supported Node.js
and npm installation; if those tools are not available, use the platform
installer from the [Salesforce CLI download page](https://developer.salesforce.com/tools/salesforcecli):

```shell
npm install --global @salesforce/cli
sf --version
```

From this QuoteWake directory, create the project environment and local
configuration:

```shell
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
  --alias quotewake-dev \
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
  --alias quotewake-dev \
  --set-default
```

After either login, verify the selected org:

```shell
sf org display --target-org quotewake-dev
```

The browser login authorizes administrative CLI operations only. It does not
populate `.env` and does not authenticate the QuoteWake Python process. See the
official [`sf org login web` reference](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_org_login_web.html).

### 4. Ensure standard Quotes are enabled

The setup script first tries to enable Quotes through deployable Salesforce
settings. If the org rejects that deployment, follow the error guidance: in
Salesforce Setup, enter `Quote` in **Quick Find**, select **Quote Settings**,
select **Enable Quotes**, save, and rerun the script. The
[Salesforce Quote setup guide](https://help.salesforce.com/s/articleView?id=sf.quotes_enable.htm&language=en_US&type=5)
documents the same controls. QuoteWake requires Quotes related to Opportunities;
it does not require the optional setting for Quotes without an Opportunity.

### 5. Deploy QuoteWake metadata and provision the runtime user

Run the setup script with no data option and provide a dedicated runtime user
email and globally unique Salesforce username. The script deploys the Quote and
Contact fields, creates or reconciles the user with the dedicated
`QuoteWake Runtime` profile, assigns `QuoteWake_User`, and prepares
the QuoteWake External Client App. It does not create demo business records:

```shell
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --runtime-user-email quotewake.runtime@example.com \
  --runtime-user-username quotewake.runtime@example.com
```

This deployment only prepares the metadata. The demo records are created in
step 9; do not add `--seed-data` yet.

The two `--runtime-user-*` options are for this initial setup step. They create
or reconcile the dedicated runtime user and configure the External Client App's
**Run As** user. Once this setup is complete, omit both options from later
`--reset-data` runs; reset only prepares the demo records and QuoteWake state.

The created user's last name is `QuoteWake Runtime` and its alias is `qwrtuser`,
so it is easy to identify in Salesforce. The `QuoteWake Runtime` profile
provides the minimal profile-level capabilities required for API access,
Lightning, and Tasks; QuoteWake object and field access remains isolated in the
`QuoteWake_User` permission set. The script never creates a password or prints
one; Salesforce sends the welcome/reset email for a newly created user.

### 6. Verify the External Client App and retrieve credentials

The setup script deploys `QuoteWake Integration` and configures its OAuth
Client Credentials policy with the runtime user as **Run As**. It also
pre-authorizes `QuoteWake_User` and enables only the `api` OAuth scope. Verify
the generated app in **Setup → External Client Apps Manager**.

Retrieve the **Consumer Key and Secret** from the app's OAuth settings (the UI
can require identity verification). Store both values in a secret manager;
never paste them into source control. Anyone holding these two values can
obtain API tokens as the runtime user.

All tokens from this flow inherit the Run As user's permissions and record
access. Salesforce can take several minutes to make a new app usable.

Get the org's My Domain URL from **Setup → My Domain**, or from the admin CLI:

```shell
sf org display --target-org quotewake-dev
```

Use the `https://<my-domain>.my.salesforce.com` instance URL, not a Lightning
UI URL and not a token endpoint path.

### 7. Create a CALL-E API key

Create a CALL-E API key from the [CALL-E API keys dashboard](https://dashboard.heycall-e.com/account/api-keys).
Copy it to a secure location; it is shown only during creation and must never
be committed to source control.

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

### 9. Create the demo data

Seed the idempotent demo hierarchy after metadata and runtime access are ready:

```shell
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --seed-data \
  --country-code US \
  --call-locale en_US
```

New demo Contacts receive fictional fixture numbers when `--test-phones` is
omitted. Existing demo `Phone` and `MobilePhone` values are preserved.

To reset the demo before another test run, execute:

```shell
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --reset-data \
  --country-code US \
  --call-locale en_US
```

`--reset-data` seeds or reconciles the demo hierarchy, deletes Tasks linked to
the demo Quotes, resets their QuoteWake state, and changes the idempotency
generation marker. The runtime user and External Client App must already be
configured by step 5; do not pass the `--runtime-user-*` options again unless
you are provisioning or changing that integration. Use reset only when
intentionally starting a new demo run.

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
  Quote, and any product lines available to the runtime user.
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

### Inspect QuoteWake state

```shell
./scripts/query-quotes.sh --target-org quotewake-dev
```

The query script opens `less -S` on an interactive terminal; press `q` to exit.

To customize QuoteWake's TOML policy, call behavior, retry rules, or logging,
see the [configuration and environment guide](doc/configuration-and-environment.md).

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

QuoteWake first persists the result with one `allOrNone=true` Composite API
request that updates the Quote and creates its completed Task together. In an
org where the runtime license cannot insert Tasks, QuoteWake records that
capability limitation and falls back to updating the Quote alone. Other
persistence failures after a call has returned stop the remaining calls in that
run and return a non-zero exit status. The standard Task is an audit trail, not
a separate local database.

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
reasons. The checked-in demo keeps `logging.raw_calle_api = true` with
`logging.redact_sensitive = true`. Raw provider payloads are an explicit support
diagnostic and must remain disabled outside a controlled session. `--show-prompt`
intentionally prints Salesforce-derived business context, so treat its output
and the rotating `logs/quotewake.log` file as business data and protect them
accordingly.

## Tests

Unit and integration-boundary tests use mocks; they do not place real calls or
contact Salesforce:

```shell
uv run pytest
uv lock --check
git diff --check
```
