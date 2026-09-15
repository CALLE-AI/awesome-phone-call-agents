# Sources

Every fact Reachable is built on, with the file path or URL it came from.
Verified on 11 September 2026 against this repository's working tree, the CALL-E
Developer API OpenAPI contract, the Department for Education's statutory
attendance guidance, and UK secondary legislation.

Nothing here is restated from memory. Where a stated assumption disagreed with a
source, the source won and the disagreement is recorded under
[Conflicts](#5-conflicts). Quotations are short phrases; everything else is
paraphrased and cited.

---

## 1. This repository

### 1.1 Where a runnable app belongs

| Fact | Source |
| --- | --- |
| A runnable app goes in `apps/<language-or-runtime>/<app-name>/`. Reachable therefore lives at `apps/python/reachable/`. | [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md), "Where to contribute" |
| An awesome-list entry goes in `README.md`; apps are also listed in `apps/README.md`. | [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md) |
| Apps are "runnable tools or focused integration demos rather than installable Agent Skills". | [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md), "App requirements" |

### 1.2 What an app must include

From [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md), "App requirements": a README
with setup and usage; a dry-run or preview mode when the app can place calls;
clear credential handling; cancellation or rollback behaviour for recurring jobs;
a fake-server, dry-run, or no-call path by default; opt-in live verification
instructions; no dependency on unpublished private packages; tests or a manual
verification path.

From the same file, "Safety requirements": every app that can place a call must
carry rules for explicit user intent, E.164 phone numbers, masking phone numbers
in summaries, no credential exposure, no hidden recurring schedules, no duplicate
jobs, clear cancellation behaviour, and boundaries for medical, legal, financial
or emergency content.

From "Out of scope" in the same file: apps that depend on private services
**without a local fake-server or dry-run path** do not belong here. Reachable's
fake CALL-E server and CSV fixtures are a gate, not a nicety.

From [`AGENTS.md`](../../../../AGENTS.md), "App design rules": prefer local fake
servers, dry runs, or preview modes for tests; do not require live credentials or
real outbound calls for default tests.

### 1.3 What `scripts/validate_repository.py` actually enforces

Read directly from
[`scripts/validate_repository.py`](../../../../scripts/validate_repository.py).
`main()` runs sixteen validators; only four can touch a new `apps/python/*` entry.

**`validate_apps()` (line 593).** For a *new* app it enforces almost nothing:

| Check | Applies to Reachable? |
| --- | --- |
| `apps/` exists; no top-level `examples/` directory | Repository-wide, already true |
| `apps/README.md` contains nine required snippets | Only if we edit it; adding a table row is safe |
| Six named pre-existing app directories still have a `README.md` | Not us |
| No `apps/**` text file contains any of four literal dependency strings | **Yes.** See the warning below |
| No `package.json` under `apps/` has a `file:` dependency | Not us (Python app) |

The four banned strings are the `forbidden_dependency_snippets` list inside
`validate_apps()`: a `file:`-pinned core dependency, either relative path that
reaches a `packages/core` directory, and the npm workspace-protocol token. They
are **not quoted in this file**, because quoting them here would itself fail the
check — this document lives under `apps/`. Read them from the validator source.

**`validate_english_only()` (line 353).** Walks every file under `apps/` whose
suffix is in `{.md, .mjs, .py, .ts, .json, .toml, .yaml, .yml}` and fails on any
CJK character. It walks the **filesystem**, not the git index, so it also
inspects files we deliberately keep untracked, such as `CLAUDE.md` and
`planning/`.

**`validate_repository_name_references()` (line 319).** Same walk; fails on the
old repository title or slug. Write "awesome-phone-call-agents".

**`validate_expected_files()` (line 472).** A fixed list of pre-existing paths.
Adding files cannot break it.

Not applicable: the email-address ban is scoped to skill `references/` and
`scripts/` files only (`iter_skill_example_and_script_text_files`, line 198), and
`validate_no_trailing_whitespace` (line 668) is called only from the Dify and
skill-acceptance validators, not repository-wide.

> **Consequence for the plan.** There is **no** check for required README
> sections, no file-layout check, and no check that a new app is listed in
> `README.md` or `apps/README.md`. Passing the validator is a low bar and is not
> evidence of a good contribution. The real gate is the
> [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md) submission checklist and human
> review.

Verified by running it: `python3 scripts/validate_repository.py` →
`Repository validation passed.`

### 1.4 Conventions Reachable copies

| Fact | Source |
| --- | --- |
| Branch format `<type>/<short-kebab-summary>`; validate with `python3 scripts/check_branch_name.py --branch <name>`. | [`docs/git-naming-conventions.md`](../../../../docs/git-naming-conventions.md) |
| Commits use Conventional Commits, `<type>(<scope>): <summary>`; `apps` is a recommended scope. | [`docs/git-naming-conventions.md`](../../../../docs/git-naming-conventions.md) |
| "Demo apps are not SDKs." Default tests must run without live credentials or real outbound calls; live verification is opt-in. | [`docs/design-principles.md`](../../../../docs/design-principles.md), Principle 7 |
| Apps that place calls must document setup, credentials, dry-run behaviour, real-world side effects, cancellation, and where results are stored. | [`docs/design-principles.md`](../../../../docs/design-principles.md), Principle 8 |
| Do not guess phone numbers, country codes, regions, timezones, or credentials. | [`docs/design-principles.md`](../../../../docs/design-principles.md), Principle 3 |
| Use IANA timezone names such as `Europe/London`; never infer a timezone from a phone number, country code, or locale. Raw UTC offsets are not preferred because they mishandle daylight saving. | [`docs/design-principles.md`](../../../../docs/design-principles.md), Principle 4 |
| Host scheduler handles recurrence; the provider places exactly one call per scheduled run. | [`docs/design-principles.md`](../../../../docs/design-principles.md), Principle 1 |

### 1.5 The production-workflow pattern

[`docs/production-workflows.md`](../../../../docs/production-workflows.md):

- "Phone calls are one step in a business workflow, not the workflow's source of
  truth. CALL-E executes and reports calls. The integrating application owns the
  business intent, authorization, idempotency, state transitions, retry policy,
  and audit history."
- "Keep application state separate from call state... Do not collapse them into
  CALL-E's call lifecycle statuses." Its example vocabulary is `reserved`,
  `submission_unknown`, `accepted`, `terminal_unverified`, `terminal_verified`,
  `needs_human`, `applied`.
- "The application should be able to reconstruct every transition from durable
  state after a process crash. A webhook can wake the worker, but it must not be
  the only record that a call or business transition exists."
- Reserve intent before submission; run a no-call preflight; submit once and
  reconcile ambiguity; receive events through a durable inbox.

### 1.6 Idempotency

[`skills/service-dispatch-call/references/idempotency.md`](../../../../skills/service-dispatch-call/references/idempotency.md):

- "The key must be **the identifier of the thing that was authorized**... Not the
  attempt." Named anti-patterns: a fresh UUID, a hash of the clock, a hash of
  payload plus clock, one identifier per attempt.
- "Reserve before dialling." Insert the record with its key, then place the call,
  then update from the terminal event. "A record that only exists after success
  is not a record."
- Deduplicate on the provider's **event** identifier, not the call identifier;
  "an event id at the root and a call id nested under `data` are easy to confuse".
- An exact replay is accepted and ignored; a conflicting payload under a known id
  is rejected and raised, never overwritten.
- The idempotency record must outlive the dispatch it guards.

### 1.7 Ambiguous outcomes

[`skills/service-dispatch-call/references/ambiguous-outcomes.md`](../../../../skills/service-dispatch-call/references/ambiguous-outcomes.md):

- Four outcomes: `answered`, `declined`, `no_answer` (retry permitted under an
  explicit cap), `unknown` (**stop; a person reconciles it**).
- "`no_answer` is a fact reported by the provider. `unknown` is the absence of a
  fact."
- "A client-side timeout tells you about your client, not about the vendor's
  telephone." Set the client timeout above provider acceptance latency; tens of
  seconds is normal and 15 seconds is a bug.
- On `unknown`: record it, do not redial or schedule a redial, surface it to a
  human, and **poll the provider's call-status lookup first** — "A lookup is
  cheap. A duplicate call is not."
- "**Ambiguity is a state, not an error.** Errors get retried. States get
  resolved."

### 1.8 Fail-closed dispositions

[`plugins/zapier-calle/docs/fail-closed-dispositions.md`](../../../../plugins/zapier-calle/docs/fail-closed-dispositions.md):

- Classify on every signal together, never one alone: event type, call status,
  `task_completed`, `completion_confidence.label`, `completion_confidence.score`,
  nullability of `structured_result`, **the values inside it**, and `failure_code`.
- "`completion_confidence.score` [is] required and bounded 0-1, while `label` is
  documented only by example... Checking only the label accepts a `high` carrying
  a score of 0.05. Check both, and make the floor configurable."
- `failure_code` is "an opaque, unbounded string for logging and for a human to
  read, never as a value you branch on by exact match".
- **Two vocabularies.** The Developer API status field uses five lowercase
  values; the CLI and MCP surface "uses a different, uppercase vocabulary that
  includes values such as `NO_ANSWER` and `VOICEMAIL` and does not map one-to-one
  onto the API vocabulary." State which you consume and reject the other.
- Ten dispositions, one actionable. "**the default is `needs_human`**."
- **Pre-flight refusals** (`outside_calling_window`, `suppressed`,
  `retry_policy_blocked`) are produced *before dialing*, never by the provider:
  "a refusal to place a call is a distinct outcome from any result of a call".
- "**A present result is not a usable result.**"

### 1.9 Call safety

[`skills/service-dispatch-call/references/safety.md`](../../../../skills/service-dispatch-call/references/safety.md):

- "A vendor's phone number being available is not authorization to call it."
  Authorization is **purpose-bound**.
- Disclose on every call that it is an automated call placed on behalf of the
  named organization. Do not imply the caller is human when asked directly. Stop
  if asked to be removed and record the refusal.
- Third-party privacy: refer to the subject by an opaque reference, give a
  one-sentence summary and nothing else, do not read out anyone's name, phone
  number, email or schedule, and do not describe circumstances that identify a
  person. If asked for identifying detail, return the question to a human.
- "**the call gathers, the human commits.**"
- Do not store transcripts or recordings without a stated legal basis the
  recipient was told about. "Audit records should name the fields that were
  returned, not the values."
- "Never place a 'test' call to a real vendor to verify configuration. Use a
  number the user owns and has explicitly offered for testing."
- Stopping is a successful outcome. Guessing is not.

### 1.10 The Roll Call maintainer review — verified

The four requirements are real and were quoted accurately. Source: maintainer
**Ray-56**, comment of **2026-09-06** on
[PR #325](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/325),
retrieved with `gh api repos/CALLE-AI/awesome-phone-call-agents/issues/325/comments`:

> - Do not send bearer credentials to an operator-controlled arbitrary origin;
>   restrict credential-bearing requests to approved secure provider origins.
> - Do not persist raw transcript, result, or provider text through JSON output;
>   deeply sanitize all stored and displayed free text.
> - Do not let an unbound guardian or generic yes/no result trigger safeguarding
>   or attendance actions. Bind the result to the approved destination and keep
>   the high-stakes interpretation explicitly human-reviewed.
> - Enforce strict ASCII E.164 validation before any live call.

**Important nuance, not in the brief.** The same maintainer posted a
**superseding review on 2026-09-11** — today — narrowing the blocking list "under
the community policy adopted on 2026-09-11" to two items: restrict
credential-bearing requests to approved secure origins and mask live provider
and JSON output; and keep unbound guardian-result safeguarding decisions
advisory and human-reviewed. It states that "optional production hardening" no
longer blocks the contribution.

So sanitisation and ASCII E.164 validation are **no longer maintainer blockers**
for Roll Call. Reachable adopts all four anyway: they are cheap, they are the
right engineering, and two of them are still blocking. Treating them as hard
requirements is stricter than the current policy requires, which is the safe
direction to be wrong in.

---

## 2. CALL-E

Primary source: the OpenAPI contract, **version 0.7.0**, from
<https://raw.githubusercontent.com/CALLE-AI/calle-docs/main/openapi/calle.openapi.yaml>
(1,640 lines). Line numbers refer to that file. Corroborated by
<https://docs.heycall-e.com/>, <https://github.com/CALLE-AI/call-e-integrations>,
and this repository's own CALL-E apps.

> `apps/python/accessline/accessline/calle_contract.py` pins `API_VERSION =
> "0.6.0"`. The live contract is 0.7.0. The endpoints and enums Reachable relies
> on are unchanged between them.

### 2.1 Python SDK

| Fact | Status | Source |
| --- | --- | --- |
| `pip install calle-ai` | Confirmed | `calle-docs` `content/guides/sdks.mdx`; `call-e-integrations` README |
| `from calle import CalleClient` | Confirmed | same, and [`apps/python/webhook-result-receiver/create_call.py:230`](../../webhook-result-receiver/create_call.py) |
| Stable version `calle-ai==0.7.0` | Confirmed | `sdks.mdx` |
| `client.calls.create(...)` is **non-blocking**, returning a call object with an id | Confirmed | `sdks.mdx`; [`create_call.py:319`](../../webhook-result-receiver/create_call.py) |
| `client.calls.create_and_wait(task=..., result_schema=...)` creates and polls, blocking until terminal or timeout | Confirmed | `sdks.mdx`; [`apps/python/quotewake/scripts/test-calle-call.py:22`](../../quotewake/scripts/test-calle-call.py) |
| `create_and_wait` also takes `timeout_seconds` and `interval_seconds` | Confirmed | `sdks.mdx` |
| `client.calls.get(call_id)` and `client.calls.wait_for_result(call_id)` exist | Confirmed | `sdks.mdx` |
| `idempotency_key` is a named SDK argument, not a header the caller sets | Confirmed | `sdks.mdx`; [`create_call.py:224`](../../webhook-result-receiver/create_call.py) |
| Exceptions `CalleAPIError`, `CalleAuthenticationError`, `CalleConnectionError`, `CalleRateLimitError`, `CalleTimeoutError` | Confirmed | [`create_call.py:236-242`](../../webhook-result-receiver/create_call.py) |
| 0.7.0 has **no Python async client** and no client-initiated cancellation | Confirmed | `sdks.mdx`, "Limitations" |

The missing async client is an architectural fact.
[`apps/python/mobilize/mobilize/transports/calle.py:1-12`](../../mobilize/mobilize/transports/calle.py)
records why that project used REST instead: `create_and_wait` "blocks the calling
thread until the call reaches a terminal state, which makes true concurrent wave
dispatch impossible without one thread per call." Reachable is FastAPI and
therefore async; any blocking SDK call must run in a worker thread.

### 2.2 REST contract

Base URL `https://api.heycall-e.com` (OpenAPI `servers`, line 6, described as a
"Placeholder developer API base URL"). Auth is `bearerAuth` (line 9), sent as
`Authorization: Bearer $CALLE_API_KEY`.

**`POST /v1/calls`** (line 12). `CreateCallRequest` (line 1124),
`additionalProperties: false`:

| Field | Required | Notes |
| --- | --- | --- |
| `task` | **yes** | `minLength: 1` |
| `recipients` | no | Array or null, `minItems: 1`. "Omit it when the task text already contains the phone targets" |
| `result_schema` | no | JSON Schema for the whole call task |
| `recipient_result_schema` | no | JSON Schema extracted per recipient |
| `metadata` | no | "caller-owned metadata echoed on the call and webhook payloads" |
| `webhook_url` | no | "per-request HTTPS webhook URL", `format: uri` |

`CallTaskRecipientRequest` (line 1180): `phones` is an **array**, required,
`minItems: 1`, each item matching `^\+[1-9]\d{6,14}$`. `locale` and `region` are
optional and nullable hints.

`Idempotency-Key` is an optional **header** (line 738), 1-255 characters:
"Reusing the same key with the same request returns the original call instead of
creating a duplicate."

Result-schema supported subset (line 1149): `type`, `properties`, `required`,
`enum`, nested `object`, simple `array.items`, `description`,
`additionalProperties: false`. **Unsupported**: `$ref`, `oneOf`, `anyOf`,
`allOf`, recursive schemas, complex format validation, `additionalProperties:
true`. The contract's own advice: "Prefer string enums over booleans for business
decisions that may be unclear, and include an `unknown` enum value."

Reserved recipient-result field names (line 1170): `summary`, `status`,
`transcript`, `call_id`, and timing fields.

**`GET /v1/calls/{call_id}`** (line 178); `call_id` matches
`^call_[A-Za-z0-9_-]+$` (line 813). **`GET /v1/calls/{call_id}/events`**
(line 254).

### 2.3 Transcript turns and speakers — how binding is possible

This is the load-bearing finding for requirement 3, and the shape is not where
one would guess.

**Transcript turns are nested at `recipients[].attempts[].transcript_turns[]`.**
They are *not* a top-level field on the call.

`CallTranscriptTurn` (line 1253), `additionalProperties: false`, requires:

| Field | Type | Notes |
| --- | --- | --- |
| `offset_seconds` | integer **or null** | "Seconds from the start of the attempt. `null` when the source line did not include a parseable timestamp." |
| `speaker` | `TranscriptSpeaker` | enum of exactly `bot`, `user`, `unknown` (line 1246) |
| `text` | string | "Spoken text for this transcript turn." |

`CallTaskAttempt` (line 1273) requires `id`, `phone` ("Phone number dialed by
this attempt"), `status`, `started_at`, `completed_at`, `summary`,
`transcript_turns`, `provider_call_id`, `failure_code`, `failure_message`.
`provider_call_id` carries an explicit warning: "Use it to match Dashboard Call
Records. **Do not use it as call_id.**"

`CallTaskRecipient` (line 1337) requires `id`, `phones` (array), `locale`,
`region`, `status`, `structured_result`, `summary`, `attempts`.

**Consequences Reachable is built on:**

1. A recipient-spoken turn is one where `speaker == "user"`. `bot` is our own
   agent and `unknown` is unattributed — **neither can support an identity
   confirmation**, so a `speaker: unknown` turn is treated as no evidence at all.
2. The number actually dialled is `attempts[].phone`, which is what the
   destination half of the binding check compares against.
3. `transcript_turns` may legitimately be empty ("Empty when no transcript is
   available"), which means no evidence, which means `NEEDS_HUMAN`.
4. `offset_seconds` may be null, so turn ordering cannot rely on it.

### 2.4 The `CallTask` response

`CallTask` (line 1390) has sixteen required fields: `id`, `object` (always
`call_task`), `status`, `task`, `recipients`, `structured_result`, `summary`,
`task_completed`, `completion_confidence`, `evidence`, `metadata`,
`failure_code`, `failure_message`, `created_at`, `completed_at`.

- `structured_result` — object **or null**: "`null` means CALL-E could not
  produce a schema-valid task-level result... or no `result_schema` was provided."
- `task_completed` — boolean **or null**: "`null` until CALL-E has a terminal
  post-summary outcome."
- `completion_confidence` — `{score: 0-1, label: string}` or null. The label is
  documented only "for example `low`, `medium`, or `high`" — not an enum.
- `evidence` — array of short strings, "Empty until CALL-E has terminal evidence."
- `failure_code` — nullable string, "**No published enum.** Preserve raw values
  for support; do not branch retry, reporting, or analytics logic on specific
  values."

### 2.5 Statuses

| Enum | Values | Line |
| --- | --- | --- |
| `CallStatus` | `queued`, `in_progress`, `completed`, `failed`, `canceled` | 1203 |
| `RecipientStatus` | `pending`, `in_progress`, `completed`, `failed`, `skipped` | 1227 |
| `AttemptStatus` | `queued`, `dialing`, `in_progress`, `completed`, `failed`, `canceled` | 1236 |
| `TranscriptSpeaker` | `bot`, `user`, `unknown` | 1246 |

**Terminal call statuses are `completed`, `failed`, `canceled`.** The contract
warns that "`in_progress` includes post-call result finalization; terminal states
are published only after the post-call outcome is available."

### 2.6 How voicemail, no answer, not-in-service and failure are reported

**They are not statuses.** None of those four words appears in any status enum.

<https://docs.heycall-e.com/errors>, "Accepted call execution outcomes":
"Lifecycle `status` is stable. `failure_code` is a nullable string without a
published enum; `failure_message` is nullable human-readable context." And
directly: "**Do not infer that a recipient declined from a generic `failed` state
or an undocumented failure message.**"

`NO_ANSWER` and `VOICEMAIL` exist only in the separate uppercase CLI/MCP
vocabulary; `no_answer` and `declined` exist only in the Goal Runs API, which
Reachable does not use.

**Therefore** the `outcome` enums in Reachable's own `result_schema` — carrying
`voicemail`, `no_answer` and `not_in_service` — are the only supported channel
for this information. `status: failed` plus `failure_code` is logged verbatim as
an opaque diagnostic and routed to a human; it is never read as "nobody answered".

Stable API error codes, which *are* safe to branch on: `invalid_request`,
`unauthorized`, `forbidden`, `rate_limit_exceeded`, `insufficient_balance`,
`unsupported_region`, `unsupported_language`, `recipient_blocked`,
`policy_violation`, `call_not_ready`, `no_recipients`, `invalid_recipient`,
`invalid_phone`, `result_schema_invalid`, `recipient_result_schema_invalid`,
`idempotency_conflict`, `goal_not_published`, `goal_not_executable`,
`goal_not_ready`, `schema_override_not_allowed`, `variables_invalid`,
`provider_unavailable`, `internal_error`, `not_found`.

### 2.7 Webhooks — and the absence of signatures

`WebhookEventType` (line 1551) is a closed enum of three terminal types:
`call.completed`, `call.failed`, `call.result_validation_failed`.

`WebhookEvent` (line 1558) requires `id`, `type`, `created_at`, `data`, where
`data` is `WebhookCallData` (line 1581), declared `allOf: [CallTask]`. The
envelope trap is stated in the contract itself: `CallTask.id` is "Terminal
webhooks return it as `data.id`; the webhook's top-level `id` identifies the
**event**."

One header parameter, `CALL-E-Event-Id` (line 821), required, matching
`^evt_[A-Za-z0-9_-]+$`. CALL-E "treats any 2xx response as delivered".

**There is no signature.** The webhook path `/calle/webhook` (line 641) declares
**`security: []`**. Searching the entire 1,640-line contract for `signature`,
`hmac`, `secret`, or any signing header returns exactly one hit: the
`CALL-E-Event-Id` parameter name.

This repository's own receiver says the same
([`apps/python/webhook-result-receiver/README.md`](../../webhook-result-receiver/README.md)):

> "The current webhook notification is unsigned. The header and body event IDs
> must match, but that equality is only a consistency check, not authentication.
> Do not rely on deprecated legacy verification helpers for this workflow. The
> authenticated `calls.get` re-fetch is the trust boundary in server mode."

> "An unverified webhook is a wake-up signal, not business authority."

**Reachable's rule:** a CALL-E webhook may only wake the reconciler. Authority
comes from `GET /v1/calls/{call_id}` with our own bearer token, and the snapshot
must satisfy the full binding check before anything is written.

### 2.8 United Kingdom: region, line and language

From the `call-e-integrations` README supported-regions table:

- `GB`, calling code **+44**, languages **English**, line region **International**.
- Verbatim: "**International** means calls are currently placed using CALL-E's
  international phone numbers and are primarily intended for testing. For
  production use with a local phone number, contact the CALL-E team to enable a
  local line for the destination country."

CALL-E supports many languages across 40+ countries, but **the UK row lists
English only**. A contact who needs another language therefore cannot be served
on a UK line, and Reachable routes them to a human rather than calling them in a
language they may not speak. That is a policy decision forced by the source, and
it is a genuine product improvement over calling anyway.

Corroborated in-repo: `region: "GB"` with `locale: "en-GB"` is the shape used by
[`apps/python/callback-coordinator/test_coordinator.py:434`](../../callback-coordinator/test_coordinator.py)
and [`skills/appointment-confirm/SKILL.md:108`](../../../../skills/appointment-confirm/SKILL.md)
(`--region GB --timezone Europe/London`).

### 2.9 Call allowance

"New users get 20 free calls to get started" (`call-e-integrations` README),
repeated on the Devpost page with a form to request more.

---

## 3. UK attendance guidance

Primary source: **"Working together to improve school attendance"**, Department
for Education, **statutory guidance**, the **July 2026 edition** (100 pages),
<https://assets.publishing.service.gov.uk/media/6a4f9ec6a6586e258d371bd0/Working_together_to_improve_school_attendance_2026.pdf>,
linked from
<https://www.gov.uk/government/publications/working-together-to-improve-school-attendance>
(page last updated 9 July 2026; the guidance applies from 19 August 2024).

Page numbers below are the PDF's own printed page numbers, extracted from the
document text.

### 3.1 More than one emergency contact

**Confirmed, twice.**

Page 20, in the list of what schools should do: "Where reasonably possible hold
**more than one emergency contact number** for each pupil. This is good practice
to give the school additional options to make contact with a responsible adult."

Page 67, in the admission-register requirements: the register must include "at
least one telephone number by which each such parent can be contacted in an
emergency. The DfE's advice is that where reasonably practicable, schools should
hold an emergency contact number for more than one person for each pupil."

This is the whole justification for Workflow A. A contact list the school is
advised to keep, and which every absence call depends on, currently decays with
nothing watching it.

### 3.2 First-day calling is the school's own process

**Confirmed, and it is explicitly one item in a longer list.**

Page 16, on what an attendance policy should set out: "The school's day to day
processes for managing attendance, for example **first day calling** and
processes to follow up on unexplained absence."

Page 20: schools should "Expect parents to contact the school when their child is
absent to explain the reason and put in place processes to contact parents on the
first day of absence where a reason has not been provided. **If absence continues
without explanation, further contact should be made to ensure safeguarding.**"

That final sentence is the single best citation for Reachable's Workflow B. The
guidance names first-day calling *and* a distinct duty to make further contact
when absence continues unexplained. Reachable automates the second, and the
policy file must record that the school performs the first.

### 3.3 Support first

**Confirmed.** Page 51 carries a section headed "Providing support first before
attendance legal intervention", describing a diagram in which "support should be
provided before legal intervention wherever possible... beginning with voluntary
support for families and pupils, followed by more formal support where needed."

This is why the pattern follow-up call asks what would help and offers a call
from the attendance officer, and why fines, penalty notices and legal action are
in the forbidden list in [`SAFETY.md`](SAFETY.md).

### 3.4 Sessions are AM and PM

**Confirmed.** Page 18, paragraph 32: "Schools must take the attendance register
at the start of each morning session and once during each afternoon session of
every school day, at the same time for all registered pupils."

Paragraph 33: on each occasion schools must record whether the pupil is
physically present and, if not, the reason using the national codes in regulation
10 of the School Attendance (Pupil Registration) (England) Regulations 2024.

Two sessions per school day is what makes "two consecutive sessions" a meaningful
trigger, and why consecutive means AM→PM or PM→next school day's AM.

### 3.5 Code N and the deadline

**Confirmed, with a correction to the code's name and to the units of the
deadline.**

Page 96, the code table entry is headed "**Code N: Reason for absence not yet
established**":

- Paragraph 407: "Schools must follow up all unexplained and unexpected absence
  in a timely manner. Every effort should be made to establish the reason for a
  pupil's absence. When the reason for absence has not yet been established
  before the register closes, the absence must be recorded with code N."
- Paragraph 408: "the correct absence code should be entered as soon as the
  reason is ascertained, but no more than **5 school days** after the session
  (regulation 10(7) to (9)). Code N must not therefore be left on the pupil's
  attendance record indefinitely; if a reason for absence cannot be established
  within 5 school days, schools must amend the pupil's record to **Code O**."
- Paragraph 409: code N is classified for statistical purposes as unauthorised
  absence.

Page 82 records a separate sub-case: a pupil recorded with code N who arrives
later in the session after the register has closed must be amended to **code U**
or another more appropriate absence code. This is a lateness case and is not the
path Reachable is concerned with.

The underlying law is **The School Attendance (Pupil Registration) (England)
Regulations 2024, regulation 10(7)–(9)**
(<https://www.legislation.gov.uk/uksi/2024/208/regulation/10/made>), which
requires the proprietor to ensure "reasonable steps are taken to establish the
circumstances of the pupil's absence" and that "the register is amended within
**five school days**".

---

## 4. Overlap search

Run with the `gh` CLI, which **is available and authenticated** (`gh` 2.92.0,
account `Uchebuzz`):

```bash
gh pr list -R CALLE-AI/awesome-phone-call-agents --state all --search "<term>"
```

Full results are in [`planning/HACKATHON.md`](../planning/HACKATHON.md). The
findings that matter:

| PR | State | Title | Relationship |
| --- | --- | --- | --- |
| [#325](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/325) | **OPEN** | `feat(roll-call): add first-hour absence verification app for schools` | **The neighbour.** TypeScript, `apps/typescript/roll-call`. Not merged to `main` — verified by listing `apps/typescript/` |
| [#387](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/387) | MERGED | school payment assistant runnable app | Schools, but fee payments. No attendance or contact overlap |
| [#244](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/244) | MERGED | Locked Door, an emergency-directory phone verifier | "Emergency" means public resource directories (cooling centres, shelters), not a pupil's emergency contacts. Its CALL-E adapter is deliberately disabled and places no calls |
| [#297](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/297) | OPEN | RingBack, appointment campaigns with a first-yes cascade | Shares the cascade shape; entirely different domain (solo practitioners' appointment books) |
| [#257](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/257) | MERGED | urgent-help-escalation-call, consent-first caregiver escalation | Escalation ladder in an eldercare context |
| [#127](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/127) | OPEN | CareBridge treatment attendance rescue skill | "Attendance" in a clinical sense |
| [#231](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/231) | OPEN | ghost-network-audit, provider-directory ghost audit | Closest idea-neighbour to Workflow A: phoning to detect stale directory data, in health insurance |

**Nothing in the repository, merged or open, does contact-list health for schools
or pattern-based absence follow-up.** Roll Call is the only schools-attendance
entry and it occupies the first hour. Reachable's two differentiators — the
trigger being a pattern after the school's own first-day process, and maintaining
the contact data the calls depend on — are unoccupied.

Roll Call's README, and the discussion on its PR, are worth reading before the
build so the README can describe it accurately and respectfully. **No code from
it is to be copied.** It is TypeScript; Reachable is Python, which removes the
temptation structurally.

---

## 5. Conflicts

Each item is a place where a stated assumption disagreed with a source.

### C1. The attendance code is "reason for absence **not yet established**"

**Stated:** the "reason not yet provided" code.

**Source:** the July 2026 guidance, page 96, heads the entry "Code N: Reason for
absence **not yet established**". The older August 2024 phrasing "no reason yet
provided" circulates widely on local-authority sites, which is probably where the
brief's wording came from.

**Effect:** cosmetic but public-facing. `SPEC.md`, the dashboard and the README
use the current statutory wording and the code letter `N`, so a school
administrator recognises it.

### C2. The deadline is 5 **school** days, and the guidance contradicts itself

**Stated:** no later than five working days after the session.

**Source:** three places, two units.
- Regulation 10(7) of the 2024 Regulations: "the register is amended within
  **five school days**."
- Guidance page 96, paragraph 408: "no more than **5 school days** after the
  session (regulation 10(7) to (9))."
- Guidance page 20: "the correct code should be inputted as soon as the reason is
  ascertained, but no later than **5 working days** after the session."

**Effect:** the operative legal unit is **school days**, which is what Reachable
counts, using the same school-calendar file that drives the session-consecutiveness
rule. School days and working days diverge across half-terms and INSET days, so
this is not pedantry — a deadline countdown built on working days would show the
wrong date every holiday. The inconsistency inside the guidance itself is
recorded here and surfaced in `SPEC.md`, because a school user may well have seen
the page 20 wording. Reachable displays the deadline as a date, not a count, and
names the rule it used.

### C3. Code N does not expire into nothing — it becomes code O

**Not stated, and load-bearing.** If the reason cannot be established within 5
school days the school **must** amend the record to **code O**. That gives
Workflow B a real deadline with a real consequence: the window in which a phone
call can still change the register outcome is finite and short. The dashboard
shows days remaining, and the trigger threshold of 2 sessions is defensible
partly because it leaves time to act inside that window.

### C4. CALL-E webhooks cannot be verified at all

**Stated:** "Find out how webhook signatures are verified."

**Source:** OpenAPI 0.7.0 declares `security: []` on the webhook path and defines
no signing header, secret or HMAC scheme. The repository's own receiver says the
unsigned notification "is a wake-up signal, not business authority."

**Effect:** Reachable does not pretend to authenticate them. The event-id header
must equal the body `id`, which is a consistency check and explicitly not
authentication; authority comes from the authenticated re-fetch plus the binding
check. This is written into `SAFETY.md` rather than left implicit, because a
reviewer will otherwise reasonably assume we simply forgot.

### C5. `create_and_wait` returns far more than four fields

**Stated:** returns `status`, `task_completed`, `structured_result`, `evidence`.

**Source:** `CallTask` has sixteen required fields. The four named are real; the
omitted ones include `completion_confidence` (`score` and `label`),
`failure_code`, `failure_message`, and per-recipient `structured_result`.

**Effect:** a disposition computed from the four stated fields would accept
`task_completed: true` carrying a confidence score of 0.05 — the exact failure
`fail-closed-dispositions.md` warns about. Reachable reads all of them with a
configurable score floor, and checks the label *as well as* the score.

### C6. Transcript turns are not where the brief implies

**Stated:** "How transcript turns and speakers are returned, since we need
recipient-spoken turns for result binding."

**Source:** they are at `recipients[].attempts[].transcript_turns[]`, and the
speaker enum is `bot` / `user` / `unknown`. Note that
`apps/python/webhook-result-receiver/fixtures/call-completed.json` in this
repository uses a flat top-level `transcript` array with
`{"speaker": "assistant"}` — a shape that does **not** match OpenAPI 0.7.0.

**Effect:** two traps avoided. Binding code that looks for a top-level
`transcript` finds nothing and, if written carelessly, concludes "no evidence"
when evidence exists — or worse, is written against the fixture and then fails
silently in production. And `speaker: "assistant"` is not a value the contract
can produce, so matching on it would never fire. Reachable's fake server is
written to the **contract**, not to that fixture, and there is a test asserting a
`speaker: unknown` turn is not accepted as recipient-spoken evidence.

### C7. `recipients` is optional and `region`/`locale` are hints

**Stated:** `POST /v1/calls` with `recipients[{phones, region, locale}]`.

**Source:** correct in shape, with three corrections. `recipients` is optional;
`phones` is an **array**; `region` and `locale` are optional, nullable hints, not
required fields.

**Effect:** minor, except that the fake server must accept the real shape, and
`region: "GB"` is a routing *hint* rather than a guarantee of a UK line.

### C8. `Idempotency-Key` is a header in REST and an argument in the SDK

**Stated:** an `Idempotency-Key` header.

**Source:** correct for REST. The SDK exposes `idempotency_key=` as a named
argument.

**Effect:** the fake server must accept whichever the chosen client emits, and
the test asserting key stability must assert on the right one.

### C9. The four Roll Call requirements are real, but two are no longer blockers

**Stated:** "A maintainer reviewed Roll Call and asked for the fixes below."

**Source:** verified verbatim from the 2026-09-06 comment. However a superseding
review **today, 2026-09-11**, narrows the blocking list to two.

**Effect:** none on the build — Reachable implements all four. Recorded because
the PR description should not claim that all four are current maintainer
blockers when two are not, and because the "community policy adopted on
2026-09-11" is worth reading before submission in case it changes other
expectations.

### C10. Roll Call calls guardians in their own language

**Not a conflict with the brief, but a contradiction between two sources.** Roll
Call's PR description states "Guardians are called in their own language (locale
and region are passed per recipient)". The `call-e-integrations` region table
lists **English only** for GB. Passing a locale is not the same as the line
supporting that language.

**Effect:** Reachable takes the conservative reading and flags non-English
contacts for a human call. If CALL-E confirms multilingual UK support, this
becomes a one-line policy change rather than a redesign.

### C11. The deadline conversion is correct

**Stated:** Monday 14 September 2026, 23:45 SGT = 16:45 UK.

**Source:** SGT is UTC+8, so 23:45 SGT is 15:45 UTC; the UK is on BST (UTC+1) on
that date, giving 16:45. **No conflict.** Recorded because an off-by-one here
costs the entry.

---

## 6. Unverified

| Claim | Why it could not be verified | How the build handles it |
| --- | --- | --- |
| CALL-E behaviour when a UK international-line call fails to route | Not documented; observable only by spending a call | Friday smoke test to a number the operator owns is the go/no-go. Fallback is the fake-server replay, which is a required deliverable anyway |
| Whether reusing an `Idempotency-Key` with a *different* body returns `409 idempotency_conflict` on `/v1/calls` as it does on Goal Runs | The calls parameter documents only the same-request case | Never reuse a key with a different body. Keys are derived from frozen tuples |
| Median CALL-E acceptance latency | Not published | Client timeout set well above it; a timeout produces an unknown submission, never a redial |
| Whether `not_in_service` is distinguishable from `no_answer` in practice | Not in any enum; depends on what the model hears and reports | Both are first-class `outcome` values in our schema. If the distinction proves unreliable, both still route to the same contact-health flag |
| Exact CSV column names exported by common UK school management information systems | Vendor-specific and not public | Reachable defines its own documented column set and ships a mapping note; the office adapts the export once |
