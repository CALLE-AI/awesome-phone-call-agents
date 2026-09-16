# PrepCheck — Google Workspace

Turns a clinic's existing Google Sheet into a multi-checkpoint pre-procedure
preparation workflow. Apps Script schedules the calls, CALL-E places them, and
each result is compared against the previous call so preparation that stops
progressing — or goes backwards — reaches a person instead of another dial.

Platform: **Google Workspace** (Google Sheets + Apps Script). No server, no
deployment pipeline, no EHR integration.

---

## Why a phone call, and why compare calls

A form can collect a patient's self-report. It cannot act on it, follow up when
the answer is "not yet", or carry what was said into a call two days later.

The comparison matters because prep steps move independently. A patient can
collect the prep kit and, in the same conversation, reveal that a step recorded
as complete was never actually done:

```
call 1   kit ✗   iron tablets ✓    prep_status = partial
call 2   kit ✓   iron tablets ✗    prep_status = partial
```

Overall status is identical. A workflow keyed on overall status sees nothing
happen. PrepCheck reports:

```
resolved: collected the bowel prep kit from the pharmacy
| REGRESSED: stopped taking iron tablets
| net: no_improvement
```

A regression means the clinic's record is wrong, not merely incomplete, so it
always emails staff regardless of what `prep_status` said.

## Triggers and actions

| | |
|---|---|
| **Trigger** | Apps Script time-driven trigger, hourly (`sweep`) |
| **Trigger** | Deployed web app `doPost` — CALL-E terminal result webhook |
| **Trigger** | Manual, from the PrepCheck menu in the spreadsheet |
| **Action** | `POST /v1/calls` — one outbound call per due patient per checkpoint |
| **Action** | Write state, per-item snapshot, and readiness delta back to the Sheet |
| **Action** | `MailApp.sendEmail` to clinic staff on regression, release, or escalation |

Apps Script executions are capped at a few minutes, so nothing waits in
memory. Every pending action is a `next_call_at` timestamp in the Sheet; the
hourly sweep picks up whatever has fallen due. A 48-hour callback is a cell
value, not a sleeping process.

## Required inputs

Per patient row in the `Patients` sheet:

| Column | Required | Notes |
|---|---|---|
| `row_id` | yes | Stable identifier; travels in call `metadata` |
| `patient_name` | yes | Used for identity verification on the call |
| `phone_e164` | yes | E.164, e.g. `+12025550143` |
| `region`, `locale` | yes | Passed to CALL-E; must be a supported combination |
| `procedure` | yes | Must match a `procedure` in the `PrepSteps` sheet |
| `procedure_at` | yes | ISO 8601, clinic local time; checkpoints are offsets from it |

The `PrepSteps` sheet maps procedure + checkpoint to the individual steps
verified on that call. Editing it changes what the agent asks; no code change.

In Script Properties: `CALLE_API_KEY`, `WEBHOOK_URL`, `WEBHOOK_SECRET`,
`STAFF_EMAIL`.

## Side effects

This plugin places **real outbound phone calls to real people** when enabled,
and sends email. Specifically:

- Up to one call per patient per checkpoint, plus up to two `PARTIAL`
  callbacks and up to two no-answer retries. Worst case per patient per
  checkpoint is three connected calls and two unanswered attempts.
- Email to `STAFF_EMAIL` on regression, slot release, and escalation.
- Writes to the spreadsheet on every call result.

It does not book, cancel, or move appointments, and it does not release a slot.
What a patient says on a call is a report, not a decision: PrepCheck records it,
stops calling, and asks a person to decide. Every outcome it writes is advisory.

## Credential handling

- The API key lives in Script Properties, never in code or the Sheet.
  `setupScriptProperties()` is the only place it is written, and its literals
  are blanked after first run.
- The webhook is deployed with anonymous access because CALL-E posts without a
  Google identity. A `?token=` shared secret is the access control; `doPost`
  rejects any request without it. Rotate it with `rotateWebhookSecret()`.
- `Idempotency-Key` is derived from row + checkpoint + attempt counters, so a
  retried or overlapping sweep cannot double-dial the same person for the same
  reason.
- The sweep holds a script lock, so two concurrent executions cannot both
  dial.

## What the webhook accepts

The endpoint fails closed. With no `WEBHOOK_SECRET` configured it rejects
everything rather than treating "unconfigured" as "open"; with one configured,
a request without a matching `?token=` is rejected and logged.

A terminal result is applied **once**, and only for the call the patient is
actually waiting on. The row must be in `IN_CALL`, the checkpoint in the
payload must match the row's current checkpoint, and any `call_id` must match
the one in flight. A result that fails any of those checks is stale,
duplicated, or out of order: it is recorded and the patient is held for staff
review, rather than being applied a second time. This matters because a
duplicate post would otherwise advance the follow-up counter and schedule
another call to a real person.

These outcomes stop the workflow instead of scheduling anything:

| Outcome | Why it stops |
|---|---|
| `asked_to_stop` | The patient opted out |
| `flag_for_staff` | Something clinical or unclear came up |
| A regression | The clinic's record is wrong; calling again builds on bad data |
| Unknown or unreadable status | Nothing reliable to act on |
| Stale or duplicate result | Already handled, or not ours |
| Two follow-ups with no progress | Calling a third time is not working |

Only an unanswered call leads to another dial, and that is capped at two
retries at different times of day.

## Dry run and preview

`LIVE_CALLS_ENABLED` is **`false` by default**. In that state the workflow runs
end to end with no side effects at all — no calls and no email. Each would-be
call is written to the `CallLog` sheet as a `DRY_RUN` row containing the task
prose and the result schema, so you can read exactly what CALL-E would work
from. The webhook secret is redacted and the recipient's number is masked in
that log: the sheet is something a clinic will share and screenshot.

Notifications in this mode are logged as `NOTIFY_SUPPRESSED` rather than sent.
There is no default staff address — an install without `STAFF_EMAIL` set emails
nobody rather than falling back to whoever ran the script.

The state machine can be exercised without spending a call by posting the files
in [`examples/`](examples/) to the deployed webhook. Because a result is only
accepted for a call in flight, each post needs a dry-run call placed first:

```bash
# in the Apps Script editor, with LIVE_CALLS_ENABLED = false:
#   callRowNow('P001')        → row moves to IN_CALL, nothing is dialled

curl "$WEBHOOK_URL?token=$WEBHOOK_SECRET" \
  --request POST \
  --header "Content-Type: application/json" \
  --data @examples/01-call-partial.json
```

Repeat that pair with `02` to see a regression detected, with `prep_status`
identical on both calls. Post `02` a second time without placing a call first
and it is refused as stale — which is the behaviour worth checking.

## Cancellation and rollback

- **Stop everything**: set `LIVE_CALLS_ENABLED = false`, or delete the hourly
  trigger from the Apps Script triggers page. Both take effect immediately;
  there is no queue held outside the Sheet.
- **What that cannot do**: a call CALL-E has already accepted is out of this
  system's hands. The kill switch means "place nothing more", not "cancel what
  is in flight". A patient whose call is already dialling will still be called.
  The window is short — dispatch happens within one sweep — but it is real, and
  it is why `IN_CALL` is not a callable state.
- **Stop one patient**: clear `next_call_at`, or set `state` to
  `STAFF_REVIEW`. The sweep only selects `PENDING`, `PARTIAL`, and `NO_ANSWER`
  rows with a due timestamp.
- **A patient asks not to be called**: the agent agrees, ends the call, and
  returns `asked_to_stop`. PrepCheck moves them to `STAFF_REVIEW` and places no
  further calls — the opt-out is handled in code, not left to whoever reads the
  sheet next.
- **Undo a state change**: every transition is logged in `CallLog` with the
  call id, and `prep_snapshot` holds the previous per-item result. Rows are
  plain spreadsheet cells and can be edited back by hand.
- **Remove the plugin**: delete the triggers, archive the web app deployment,
  revoke the API key. Nothing persists outside the spreadsheet and Script
  Properties.

## Scope boundary

The agent verifies **whether** a preparation step was completed. It does not
discuss results, symptoms, doses, or anything clinical.

Written into the task prompt:

- Opens by stating it is an automated assistant, naming the clinic
- Verifies identity before disclosing any appointment or medical detail
- Voicemail and third parties get the clinic name and a callback number only —
  never the procedure, the date, or any prep instruction
- A clinical question is acknowledged, flagged, and the call ends; no
  follow-up questions about symptoms
- "Stop calling me" is honoured immediately
- Never claims to be a nurse, doctor, or human

The schema is built to make that boundary easy to hold: most fields are
enumerations or booleans, and `flag_for_staff` routes a clinical remark to a
person rather than recording it.

It does not make the boundary impossible to cross. `outstanding_plan` and the
item arrays are free text, so a patient's volunteered remark about their health
could end up in one of them despite the instruction not to record it. That is
why free text is truncated and stripped before it reaches a log or a cell, why
`flag_for_staff` stops the workflow rather than merely tagging it, and why this
is documented as a limitation rather than claimed as a guarantee — see
[`examples/05-call-clinical-question.json`](examples/05-call-clinical-question.json).

Out of scope: post-discharge check-ins, medication reconciliation,
adverse-event capture, triage.

## Not production-ready

This is a reference implementation. It ships with synthetic patient data using
reserved fictional numbers and should not be pointed at real patients as-is.

Production deployment requires a Business Associate Agreement with every vendor
in the call chain, PHI redaction in transcripts and logs, audit retention, and
independent confirmation that Apps Script is covered under the clinic's own
Google Workspace agreement. The design limits exposure where it can — minimal
context passed into the call, no clinical detail in voicemail, a schema that
cannot carry clinical data — but those are not a compliance programme.

## Setup

1. New Google Sheet → Extensions → Apps Script.
2. Add each file from [`src/`](src/) as a script file of the same name.
   `Sidebar.html` is an HTML file named `Sidebar`.
3. Project Settings → show the manifest → replace with
   [`appsscript.json`](appsscript.json). Set `timeZone` to the clinic's zone;
   every checkpoint offset is computed against it.
4. Run `setupSheets()`. This creates `Patients`, `PrepSteps`, and `CallLog`,
   seeded with synthetic rows.
5. Deploy → New deployment → Web app, execute as yourself, access **Anyone**.
   Copy the `/exec` URL. Opening it in a browser should return
   `{"ok":true,"service":"prepcheck"}`.
6. Fill in and run `setupScriptProperties()`, then blank its literals again.
   Note the webhook secret printed to the log.
7. Post the files in `examples/` to verify the state machine without calling.
8. Run `installTriggers()` for the hourly sweep.
9. Only then consider setting `LIVE_CALLS_ENABLED = true`, against a number you
   own.

After editing any file, redeploy a **new version** of the web app — the
deployed `/exec` runs the code as it was at deploy time.

## Using it

Clinic staff never open the script editor. A **PrepCheck** menu appears in the
spreadsheet with a patient list panel: patients needing attention first, each
with a one-word standing and the step holding them up. Opening a patient shows
their preparation as a timeline — which checkpoint they have reached, which
steps are confirmed, which are outstanding, and whether readiness is moving.

## Files

| File | Purpose |
|---|---|
| `src/Config.gs` | Clinic identity, checkpoints, thresholds, the kill switch |
| `src/Sheet.gs` | Schema, setup, row accessors |
| `src/Calle.gs` | CALL-E client, result schema, task prompt |
| `src/Sweep.gs` | Hourly trigger and queue selection |
| `src/Webhook.gs` | `doPost` handler and state transitions |
| `src/Regression.gs` | Per-item comparison across calls |
| `src/Menu.gs` | Spreadsheet menu and panel server functions |
| `src/Sidebar.html` | The clinic-facing panel |
| `appsscript.json` | Manifest — scopes and web app access |
| `examples/` | Synthetic call results and sample sheet data |

## States

| State | Meaning | Next |
|---|---|---|
| `PENDING` | Awaiting the call at this checkpoint | Sweep picks it up when due |
| `IN_CALL` | Call placed, awaiting result | Webhook resolves it |
| `PARTIAL` | Patient will finish the outstanding steps | Callback in 48h, twice at most |
| `PREPARED` | Checkpoint cleared | Advance to the next checkpoint |
| `CONFIRMED` | All checkpoints cleared | Appointment stands |
| `NOT_PREPARED` | Patient reports they cannot be ready | Flagged for staff to review the slot |
| `NO_ANSWER` | Did not connect | Retry twice, different times of day |
| `STAFF_REVIEW` | Needs a person | Escalated; calling stops |

If a webhook is ever missed, `reconcileStuckCalls()` polls
`GET /v1/calls/{id}` for rows left in `IN_CALL` and applies the same
transitions.
