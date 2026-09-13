# Response Mapping

Use this reference when converting Google Forms API responses into provider call
candidates.

## Field Slugs

The reference form puts stable slugs in item help text:

```text
field: lead_name
field: phone
field: product_interest
field: known_need
```

The extraction script maps:

```text
form.items[].questionItem.question.questionId -> field slug
```

Section headers and non-question items are ignored.

## Template Fields

The default template lives at `skills/google-form-callback/template.md`. It contains:

- JSON configuration for form fields, required fields, phone field, recipient name field, language, and writeback field names
- a `Goal Template` text block rendered into the CALL-E provider goal

Change form fields or the call goal by editing `template.md`; do not hardcode
business-specific field names in scripts.

## Required Fields

A response can become a call candidate only when all template `requiredFields`
are present. In the default lead quote workflow:

- `lead_name`
- `phone`
- `product_interest`

The template's `phoneField` must match:

```text
^\+[1-9]\d{6,14}$
```

## Submission Basis

The default template uses form-level authorization:

```json
{ "submissionAuthorizesCallback": true }
```

The extractor treats this as a hard gate: if the template does not set
`submissionAuthorizesCallback` to `true`, no ready call candidates are emitted.
It also requires the exported form description or template description to
clearly mention phone or call follow-up. If a workflow needs per-response
consent instead, add that field to `template.md`, list it in `requiredFields`,
and set `submissionAuthorizesCallback` to `true` only for a template where a
submitted response with that required field authorizes the callback.

## Goal Compilation

Do not let respondents write raw provider goals. Compile the provider `goal`
from:

```text
template fields + skills/google-form-callback/template.md Goal Template
```

Missing optional fields render as `not provided` unless wrapped in a conditional
block:

```text
{{#known_need}}
Mention the known requirement: {{known_need}}.
{{/known_need}}
```

Conditional blocks are omitted when the field is missing or blank.

## Dedupe

Use `responseId` as the primary dedupe key. If the selected state store shows a
response was already processed, skip it.

Phone-number dedupe can be added as a policy choice, but do not silently drop
separate responses from the same phone number unless the workflow explicitly
requests that behavior.

When a submitted-time window is configured, filter responses by
`lastSubmittedTime` when present and `createTime` otherwise before building call
candidates. Keep `responseId` dedupe enabled even inside a time window; time
filtering limits the candidate set but does not replace processing state.

The state processor stores both a simple ID list and metadata:

```json
{
  "processedResponseIds": ["resp-1"],
  "processedResponses": {
    "resp-1": {
      "status": "completed",
      "processedAt": "2026-05-25T00:00:00.000Z",
      "callRunId": "provider-run-id",
      "note": "Lead confirmed interest and prefers email follow-up."
    }
  }
}
```

## Writeback

The process script can emit a writeback JSON file:

```json
{
  "results": [
    {
      "formId": "form-id",
      "responseId": "resp-1",
      "responseIndex": 0,
      "createTime": "2026-05-26T10:00:00.000Z",
      "lastSubmittedTime": "2026-05-26T10:00:00.000Z",
      "resultField": "call_result",
      "summaryField": "call_summary",
      "call_result": "COMPLETED",
      "call_summary": "Lead confirmed interest."
    }
  ]
}
```

Import that JSON through `writeCallbackCallResultsFromJson(jsonText)` in the
reference Apps Script to update the matching row in the linked response
spreadsheet.
