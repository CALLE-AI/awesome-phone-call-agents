# Shift Safety Call Agent

Turn post-shift safety phone check-ins into structured records for human review.
This local prototype demonstrates how a shift supervisor could review reported
concerns and incomplete answers. All default scenarios are fictional and run
through a deterministic Fake Provider: they do not place or simulate audio calls.
This application does not provide automated safety clearance.

## Reviewer quick start: no account, key, recipient, or call

Requires Python 3.12 or later. Python 3.12.13 is the tested interpreter. Run all
commands below from this app directory, not the repository root.

```sh
python -m venv .venv
```

Activate it with `.venv\Scripts\Activate.ps1` in PowerShell, or
`source .venv/bin/activate` on macOS/Linux. Then:

```sh
python -m pip install -e ".[web]"
shift-safety-call-agent scenarios
shift-safety-call-agent run-fake --scenario no-incident
python scripts/prepare_demo.py
```

Installation downloads public Python packages; it does not contact CALL-E.
The app has no unpublished/private dependency. The optional CALL-E SDK is not
needed for this path. No credentials or environment file are needed.
Defaults remain `CALL_PROVIDER=fake` and `ALLOW_REAL_CALLS=false`.

The preparation script creates a new unique directory under `runtime/` with
exactly four fictional records in `records.db`. It never overwrites/deletes an
existing demo, starts a server/browser, or selects a live provider. Result contents
and scenario order are deterministic; the directory name is unique per run.
It prints a command like this (use the actual relative path it prints):

```sh
shift-safety-call-agent serve-api --db-path runtime/demo-<generated>/records.db --port 8765
```

Open `http://127.0.0.1:8765/app`. The UI and API use the same origin. The server
binds only to loopback, with no host override, CORS, CDN, analytics, or external
assets. Ctrl+C stops the server; the fictional database remains local. The UI's
simulated-interview controls can add more Fake Provider records, never real calls.
There is no database delete/reset route or command.

## What to inspect

CALL STATUS describes provider/workflow execution. It is not safety clearance.
REVIEW DISPOSITION describes how a human should handle the record; it is derived
deterministically from explicit result fields and completion state, not a new AI
judgment. Suggested human actions use fixed application-owned wording.

| Fictional scenario | Call status | Review disposition |
| --- | --- | --- |
| No incident | Completed | No immediate action |
| Minor near miss | Completed | Action required |
| Equipment follow-up | Completed | Action required |
| Incomplete answers | Completed | Needs clarification |

Open Equipment follow-up to see the review basis and suggested human inspection.
Open Incomplete answers to see Incident = Unknown, unavailable answers = Not
available, and guidance to obtain missing answers before completing human review.
Unknown/unavailable values are not converted to No. `not_assessed` remains
distinct for failed, cancelled, task-incomplete, or absent-result work. Even
No immediate action is not an automated safety decision.

Structured result confidence is an auxiliary value attached to a result. It is
not a safety severity score and is not used to decide follow-up. Fake confidence
values are fixed fixture data, not measurements of voice or interview quality.

## Architecture and localization boundary

The CLI/application service orchestrates the Fake Provider through ports. Typed
domain models do not import CALL-E, FastAPI, or SQLite. SQLite is an adapter;
FastAPI exposes an allowlisted local review view, with packaged HTML/CSS/JavaScript.
The Web UI/API cannot invoke CALL-E. The optional one-shot live CLI has a separate
guarded production factory; contract-test permits are never production permits.

The public `en-safety-v2` task is an English reference task for this repository.
It has NOT been live-call validated. Public verification in this contribution is
limited to deterministic Fake Provider scenarios, offline contract tests, and
the documented no-call reviewer path. It does not establish live-call behavior
or English speech quality.

The English reference retains six sequential checks: fictional work overview,
safety concerns, near miss, equipment/tool abnormality, injury/feeling unwell, and
handover/follow-up. It waits for each answer, clarifies interruptions and ambiguous
short replies, does not infer a safe answer or termination, ends immediately on
consent refusal, permits explicit early termination, and checks final handover
information. It requests no real employer-internal or personal information and
makes no emergency, medical, or legal judgments. The public task and fixtures are
English-only. The optional recipient gate still restricts self-calls to Japan;
English localization does not broaden dialing permissions.

`safety-result-v1` defines fixed fields, enums, required fields, and a strict
normalizer for the public English reference task. Unknown remains unknown. Call
completion and task completion are separate: a terminal call can have an
incomplete task or no usable structured result. The public triage keeps the
existing English handover-note recognition for the fixed tool-inspection guidance.

An offline preview shows the English task without loading credentials or calling:

```sh
shift-safety-call-agent preview-calle --scenario no-incident --show-task
```

## Optional CALL-E capability: not a reviewer step

`calle-ai==0.6.0` is optional and pinned. Maintainers who separately choose to
inspect SDK contracts can install `python -m pip install -e ".[web,calle]"`.
Installing/importing the SDK or a successful `live-preflight` does not authorize
execution. `live-preflight` does not construct a client or send a request.

Only `live-call-self` can cross the production request boundary. Do not run it as
part of this demo or verification. A separately authorized operator must satisfy
all preserved gates:

- Explicit intent, `CALL_PROVIDER=calle`, and `ALLOW_REAL_CALLS=true`.
- An operator-managed `CALLE_API_KEY` and one self-owned `CALLE_RECIPIENT_E164`,
  provided at runtime, never in source, command examples, committed files, or logs.
- A single Japanese +81 E.164 recipient; non-+81 and +810 forms are rejected.
  Do not use this capability for coworkers or other third parties.
- `CALLE_HUMAN_CONFIRMATION` must exactly equal
  `I CONFIRM THIS CALL IS TO MY OWN PHONE`.
- An interactive TTY and the exact final phrase `PLACE ONE CALL NOW`, entered
  immediately before execution. The phrase cannot come from a file/environment.
- Recipient-side consent at the beginning of the fictional interview.

The app makes at most one create attempt per command: no automatic retry, batch,
schedule, or recurring job. A real call can incur charges and transmit the task,
recipient, and conversation to CALL-E. Before the final permit, refusal, EOF, or
interruption aborts locally without a request. After sending a request, stopping
the process or a local timeout does NOT prove the provider stopped the call; the
application implements no provider-side rollback/cancellation guarantee. Do not
retry automatically after an uncertain outcome. No live execution is part of
this reference's test path, and English voice behavior remains unverified.

## Persistence and privacy

Fake runs are in memory unless saved. The preparation script explicitly saves
only fictional structured records to an ignored local SQLite database. For the
optional live command, persistence is opt-in with `--save`, and task-incomplete or
unsafe-to-normalize results are not saved. Transcripts are not persisted by the
application. SQLite rejects unsafe text/identifiers and never stores phone
numbers, keys, authorization values, or raw provider payloads. This is not a
general-purpose anonymizer: use fictional data only. Provider-side retention is
outside this application's control.

Live provider identifiers are not printed or persisted. Live saves set the
provider run ID to null, without hashing, truncation, encoding, or substitution.
Fake Provider synthetic run IDs may remain internally as fictional test data.
CLI detail views, API responses, and the Web UI withhold provider run identifiers,
including any identifier present in an older or injected record. Application-owned
interview IDs are separate local record identifiers, not provider IDs. Existing
databases are not rewritten or migrated by this change.

UI/API responses omit tasks, evidence text, transcripts, credentials, recipients,
raw provider data, and database paths. Public assets must omit real
phone numbers, keys, call/run/dashboard IDs, personal email/paths, transcripts,
raw evidence/payloads, live audio, and unredacted account/dashboard screens.
No recordings, screenshots, logos, databases, or private Git history are shipped.
Synthetic SDK response fixtures are authored test data, not captured calls.

## Tests and verification

```sh
python -B scripts/verify.py
```

This runs the app's unittest suite with source imports, fake defaults, credential
variables removed, and a socket audit guard that rejects non-loopback network
access. Temporary databases and in-process FastAPI TestClient requests verify the
no-call path. SDK-specific tests skip when the optional SDK is absent; install
the pinned extra only for offline contract coverage. No test needs a real key,
phone number, account, or CALL-E request. The guard permits local event-loop
sockets, not external traffic. Tests also check English-only candidate content.

From the repository root, also run the unmodified official checks:

```sh
python scripts/check_branch_name.py --branch feat/shift-safety-call-agent
python scripts/validate_repository.py
git diff --check
```

## Limits and license

This is a runnable local test build, not a production safety system, supported
SDK, emergency service, or medical/legal/financial decision tool. Human review
remains necessary. Do not use it for actual workplace clearance. Default Fake
results demonstrate data flow, not CALL-E behavior or English speech quality.
There is no cloud deployment, authentication layer, scheduling, or multi-recipient
operation. Keep the server local and do not share a database containing real data.
Hackathon judging-access acceptance requires separate organizer review.

Code is MIT licensed; see [LICENSE](LICENSE). No external media or vendor logos
are included. Dependency licenses and the non-vendoring boundary are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
