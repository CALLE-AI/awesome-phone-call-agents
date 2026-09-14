# Safety

Google Form callback workflows can trigger real-world phone calls. Treat each
eligible response as a side-effect request that must be validated before any
provider is called.

## Explicit Intent

Run this skill only when the user asks to process specific forms, or explicitly
asks to process all accessible Google Forms for this callback workflow, or when
an already approved automation is executing that exact workflow.

Drive discovery may be used only to find Google Forms files by MIME type. Do
not scan arbitrary Forms, Sheets, or Drive files for phone numbers and call
them.

## One-Off Confirmation

When the user input does not include scheduling language, run a dry-run preview
first and ask the user to approve the exact pending call list before execution.
The execution script's `--approved-real-calls` flag is only valid after that
approval.

When the user input includes scheduling language, the scheduler plan approval
authorizes future runs unless the user explicitly requests preview-only mode.
Before creating the scheduler job, Google and CALL-E auth preflight must pass in
the environment that will own the schedule. Each scheduled run must still
perform a runtime preflight guard, internal dry-run validation, deduplicate by
`responseId`, and use masked phone numbers in summaries, but it must not ask for
another per-run or per-response confirmation when the rendered plan has
`approvedRealCalls: true`.

## Submission Basis

A form can use a form-level callback basis when its description, ad copy, or
terms make clear that submitting the form can result in a phone follow-up.

If the form does not clearly authorize phone follow-up, add a per-response
consent field to `template.md` and list it in `requiredFields`, or skip the
response.

`extract-callback-candidates.mjs` enforces the template-level gate. The template
must set `submissionAuthorizesCallback: true`; otherwise extracted responses are
skipped and no ready call candidates are produced. The exported form description
or template description must also clearly mention phone or call follow-up.

## Phone Numbers

Require E.164 phone numbers. Do not infer country codes from locale, region,
language, IP address, timezone, or other form fields.

Mask phone numbers in user-facing summaries. A common mask is `+1******0176`.

The full phone number may be passed to a private provider call payload only
after the response is validated and approved.

## Credentials

Do not expose:

- Google OAuth access tokens or refresh tokens
- provider credentials
- auth callback URLs
- confirmation tokens
- cookies
- private full phone numbers in public logs

## Duplicate Calls

Deduplicate by `responseId` before planning calls. If state cannot be checked,
show a dry-run preview and ask before calling.

Do not claim a response was called until the provider confirms a call run.

## Scheduling

Use the default architecture:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

For multiple forms, create one scheduler plan per form. Do not ask CALL-E to
own a multi-form schedule.

## Writeback

Write call results only after the provider returns a call run or terminal
status. Writeback records must be keyed by `responseId`.

Do not write transcripts or sensitive personal data into public sheets unless
the user explicitly requested that storage and the storage location is approved.

## Sensitive Domains

For medical, legal, financial, or emergency content, generated goals must be
logistics-only. The call can collect details, confirm appointments, or route to
a human. It must not provide professional advice, diagnosis, investment
recommendations, legal conclusions, or emergency instructions.

## Cancellation

For one-off immediate calls, cancellation is only possible before the provider
call runs.

For scheduled form polling, cancellation belongs to the host scheduler plan for
that form. Report the cancellation path when a scheduled plan is created.
