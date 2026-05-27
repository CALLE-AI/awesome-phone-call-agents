---
name: google-form-callback
description: Turn Google Form lead or callback responses into safe one-off AI-agent phone calls with template-driven goals, scheduled runs, and result writeback.
license: MIT
---

# Google Form Callback

Use this skill when the user wants to process responses from one or more Google
Forms and call respondents who submitted a form that clearly authorizes a phone
follow-up.

`google-form-callback` is an intake, scheduling, and safety orchestration skill.
It does not create a new phone provider, does not create provider-side recurring
schedules, and does not call every phone-looking value in a form. It turns a
known form template into reviewed one-off call candidates.

## When To Use

Use this skill for:

- Google Form lead follow-up workflows
- quote request forms
- callback request forms
- appointment or support follow-up forms
- dry-run previews before placing calls from form submissions
- scheduled polling of one or more forms

## When Not To Use

Do not use this skill to:

- scrape arbitrary forms for phone numbers
- call respondents from forms whose description or terms do not authorize phone follow-up
- infer country codes or repair ambiguous phone numbers
- create provider-side recurring phone-call jobs
- expose Google OAuth tokens, provider credentials, confirmation tokens, or full phone numbers in user-facing summaries
- provide medical, legal, financial, or emergency advice during generated calls

## Template Contract

Edit `skills/google-form-callback/template.md` when the form fields or generated
CALL-E goal should change. The extraction script reads this file directly, so
field and goal changes should not require code edits.

Do not duplicate business field names or goal text in `SKILL.md`. Treat
`template.md` as the source of truth for:

- form fields and required fields
- the E.164 phone field
- the recipient name field
- generated CALL-E goal text
- writeback result and summary field names

Phone numbers must already be E.164.

## Workflow

1. Confirm the user explicitly wants to process specific Google Forms for callback calls.
2. Confirm each form's description or terms make phone follow-up clear.
3. Run auth preflight before any export or dry-run. For an end-to-end callback
   workflow, Google and CALL-E must both be ready before continuing. If either
   side is unauthenticated, start the repair flow and stop until the user
   completes authorization.
4. Obtain Google Forms metadata and response payloads for the requested form IDs
   or Drive-discovered forms, plus any submitted-time window, preferably through
   the local OAuth Google API client.
5. Extract field slugs from form item descriptions or help text.
6. Normalize each response into structured fields.
7. Validate required template fields, E.164 phone numbers, and responseId dedupe state.
8. Compile the provider `goal` from `skills/google-form-callback/template.md`.
9. Run a dry-run preview first. Show masked phone numbers and skip reasons.
10. Place calls only after explicit user confirmation or inside an already approved scheduled run.
11. Record processed `responseId` values and write the template-defined result and summary fields to the matching row in the linked response spreadsheet.

## Execution Mode

If the user input does not include scheduling language, use one-off execution:

1. Extract candidates.
2. Run `process-callback-candidates.mjs --dry-run`.
3. Show the pending and skipped counts with masked phone numbers.
4. Continue to `--execute --approved-real-calls` only after the user confirms that exact dry-run result.

If the user input includes scheduling language, such as "every day at 6pm",
run `preflight-auth.mjs --repair-all` before creating any scheduler job. Create
the scheduler job only after Google and CALL-E auth both pass. Then render
scheduler plans with `authPreflightOk: true`. The scheduler job approval is the
confirmation for future real calls unless the user explicitly asks for
preview-only mode. Scheduled runs must still run the dry-run check internally,
but must not ask for another per-run or per-response confirmation when
`approvedRealCalls` is true. For real scheduled calls, include a response time
window. If `submittedAfter` is not configured, `render-runtime-plans.mjs`
generates a `submittedAfter` value at plan-render time so the first scheduled
run does not process old form responses.

## Scripts

Use `scripts/google-auth.mjs` for local Google OAuth. The user authorizes once
in the browser, and the token stays on the user's machine:

```bash
node skills/google-form-callback/scripts/google-auth.mjs login \
  --credentials ~/.config/google-form-callback/oauth-client.json
```

Before exporting forms, dry-running candidates, or running calls, use
`scripts/preflight-auth.mjs` to check Google and CALL-E auth together:

```bash
node skills/google-form-callback/scripts/preflight-auth.mjs
```

For the normal end-to-end form callback workflow, repair both auth paths before
continuing:

```bash
node skills/google-form-callback/scripts/preflight-auth.mjs --repair-all
```

If `--repair-all` starts a browser or returns CALL-E login instructions, stop
the workflow until the user completes authorization. Then rerun the same
preflight command and continue only when it returns `ok: true`.

For lower-level debugging, Google and CALL-E can still be repaired separately:

```bash
node skills/google-form-callback/scripts/preflight-auth.mjs --repair-google
node skills/google-form-callback/scripts/preflight-auth.mjs --start-calle-login
```

Use `scripts/google-local-api-client.mjs` as the default Google route after
local OAuth is available. If form IDs are known, export those forms directly:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "FORM_ID" \
  --output form-export.json
```

If the user asks to process all forms in the account for a time window, discover
forms through Drive and export matching responses:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --discover-forms \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

Use `--action list-forms` when the user only wants to inspect accessible Google
Forms before processing:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action list-forms
```

To export only responses submitted in a time window, pass RFC3339 UTC
timestamps. `--submitted-after` is inclusive and `--submitted-before` is
exclusive:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "FORM_ID" \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

Use `scripts/google-form-api-client.mjs` only when the user has deployed and
authorized the reference Apps Script Web App fallback. This keeps Google Forms
and Sheets operations behind a preauthorized API that host agents can call from
scripts:

```bash
GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/google-form-api-client.mjs \
  --url "https://script.google.com/macros/s/.../exec" \
  --action export \
  --form-id "FORM_ID" \
  --output form-export.json
```

The Apps Script fallback accepts the same `--submitted-after` and
`--submitted-before` flags when exporting.

Use `scripts/extract-callback-candidates.mjs` to turn Forms API JSON into call candidates:

```bash
node skills/google-form-callback/scripts/extract-callback-candidates.mjs \
  --form form.json \
  --responses responses.json \
  --template skills/google-form-callback/template.md
```

The extractor only emits ready candidates when the template has
`submissionAuthorizesCallback: true` and the exported form description or
template description clearly mentions phone or call follow-up. If that
form-level basis is not valid for the workflow, add a per-response consent field
to `template.md`, include it in `requiredFields`, and keep
`submissionAuthorizesCallback: true` only when a submitted response with that
field authorizes callback calls.

If the input payload was not already filtered, `extract-callback-candidates.mjs`
also accepts `--submitted-after` and `--submitted-before` as a defensive
client-side response filter.

Then use `scripts/process-callback-candidates.mjs` for the approval and state layer:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --dry-run
```

To run real calls through CALL-E sequentially after the dry-run result is
explicitly approved:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --execute \
  --approved-real-calls \
  --poll \
  --writeback callback-writeback.json
```

To write results directly to Google Sheets after each approved run with local
OAuth, pass `--writeback-local`:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --execute \
  --approved-real-calls \
  --poll \
  --writeback callback-writeback.json \
  --writeback-local
```

To write through the Apps Script fallback instead, deploy the reference Apps
Script as a Web App, set `CALLBACK_API_TOKEN`, and pass the Web App URL:

```bash
GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --execute \
  --approved-real-calls \
  --poll \
  --writeback callback-writeback.json \
  --writeback-url "https://script.google.com/macros/s/.../exec"
```

Use `--post-writeback callback-writeback.json --writeback-url ...` to retry
only the sheet writeback without placing another call.

Use `scripts/render-runtime-plans.mjs` when the user asks for a schedule such as
"call every day at 6pm". Pass every form ID in the config; the script returns
one scheduler plan per form because CALL-E does not manage multi-form schedules.
Run `preflight-auth.mjs --repair-all` first, and pass `authPreflightOk: true`
only after Google and CALL-E auth both pass; the plan renderer refuses to create
scheduled runtime prompts without it.
`approvedRealCalls` defaults to `true`, which means the scheduled runtime will
place calls after its internal dry-run validation without asking again. Set it
to `false` only for an explicitly preview-only schedule. The rendered runtime
prompt includes `--poll --writeback <path>` so result records are captured, plus
the configured local OAuth or Apps Script writeback route. Configure
`submittedAfter` or `submittedBefore` globally or per form when the approved
schedule should use a specific response window.

```bash
node skills/google-form-callback/scripts/render-runtime-plans.mjs \
  --config schedule-config.json
```

Use `scripts/render-form-script.mjs` after editing `template.md` to generate a
Google Apps Script form creator from the template fields:

```bash
node skills/google-form-callback/scripts/render-form-script.mjs \
  --template skills/google-form-callback/template.md
```

## Provider Boundary

This skill prepares and optionally executes one-off provider call requests:

```json
{
  "to_phones": ["+15550101234"],
  "goal": "Compiled from template.md...",
  "language": "English"
}
```

The provider handles exactly one call per approved candidate. The host
scheduler, automation, or operator controls when the skill processes form
responses. For recurring runs, use this default architecture:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

## Result Writeback

Google Forms does not provide hidden post-call respondent fields. The local
OAuth client writes results to the original linked response spreadsheet row. It
adds a `response_id` helper column when needed, then writes the
template-defined result and summary columns in that same row.

The local OAuth route requires the form to already have a linked response
spreadsheet because the Google Forms API exposes `linkedSheetId` as output-only.
If the form has no linked spreadsheet, link one in Google Forms or use the
Apps Script fallback.

For automatic local-OAuth writeback, use `--writeback-local`; the call processor
writes the same payload after the CALL-E call reaches a terminal result.

For Apps Script fallback writeback, deploy the Apps Script as a Web App and use
`--writeback-url`. The Apps Script Web App API also supports `health` and
`export` actions through `google-form-api-client.mjs`.

Older test runs may have created a separate `Call Results` sheet. New local
OAuth and Apps Script writebacks do not use that sheet.

## Safety Rules

Read `references/safety.md` for the full safety contract.

Always follow these rules:

- Phone calls are real-world side effects.
- Require explicit user intent before processing a form for phone calls.
- Require a known form template whose submission basis authorizes phone follow-up.
- Require E.164 phone numbers and do not guess country codes.
- Mask phone numbers in summaries.
- Deduplicate by `responseId`.
- Create one scheduler plan per form.
- Do not expose Google OAuth tokens, provider credentials, confirmation tokens, cookies, or callback URLs.
- If a response requires medical, legal, financial, or emergency judgment, collect logistics or route to a human instead of giving advice.
- Do not state that a call was placed unless the provider call actually ran and returned success.

## References

- `references/google-forms-api.md`: fetching form and response payloads
- `references/google-oauth-setup.md`: publisher setup for local OAuth
- `references/response-mapping.md`: mapping Forms API response data to call candidates
- `references/runtime-prompt.md`: scheduled run prompt for one form
- `references/safety.md`: phone-number, dedupe, scheduling, and sensitive-domain rules
- `references/examples.md`: example response processing and dry-run output
