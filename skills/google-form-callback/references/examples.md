# Examples

The phone numbers in these examples use reserved fictional 555-01xx numbers.

## Lead Quote Request

Normalized response:

```json
{
  "responseId": "resp-1",
  "fields": {
    "lead_name": "Marcus Johnson",
    "phone": "+14045550176",
    "product_interest": "commercial ice machine",
    "known_need": "around 500 lbs of ice per day for a seafood restaurant"
  }
}
```

Candidate:

```json
{
  "formId": "form-1",
  "responseId": "resp-1",
  "status": "ready",
  "templateName": "lead-quote-callback",
  "maskedPhoneNumber": "+1******0176",
  "recipientName": "Marcus Johnson",
  "providerRequest": {
    "to_phones": ["+14045550176"],
    "language": "English",
    "goal": "Follow up with a lead who submitted an ad form..."
  }
}
```

Authorize Google locally once:

```bash
node skills/google-form-callback/scripts/google-auth.mjs login \
  --credentials ~/.config/google-form-callback/oauth-client.json
```

Check Google and CALL-E authorization before export or execution:

```bash
node skills/google-form-callback/scripts/preflight-auth.mjs --repair-all
```

Continue to export only after preflight returns `ok: true`.

Export responses through the local OAuth Google API client:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "form-1" \
  --output form-export.json
```

Export only responses submitted in a UTC time window:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "form-1" \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

List accessible Google Forms through Drive:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action list-forms \
  --output forms.json
```

Export all accessible Google Forms with responses in a UTC time window:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --discover-forms \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

Export responses through the Apps Script fallback:

```bash
GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/google-form-api-client.mjs \
  --url "https://script.google.com/macros/s/.../exec" \
  --action export \
  --form-id "form-1" \
  --output form-export.json
```

The Apps Script fallback accepts the same `--submitted-after` and
`--submitted-before` flags.

Dry-run through the state processor:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --dry-run
```

For one-off execution, show this dry-run result to the user and continue only
after they explicitly approve the pending calls.

Approved real calls through CALL-E:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --input candidates.json \
  --state callback-state.json \
  --execute \
  --approved-real-calls \
  --poll \
  --writeback callback-writeback.json
```

Approved real calls with automatic Google Sheets writeback:

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

Approved real calls with automatic Apps Script writeback:

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

Retry only writeback without another call:

```bash
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --post-writeback callback-writeback.json \
  --writeback-local
```

Retry only Apps Script writeback without another call:

```bash
GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/process-callback-candidates.mjs \
  --post-writeback callback-writeback.json \
  --writeback-url "https://script.google.com/macros/s/.../exec"
```

For manual Apps Script import, pass `callback-writeback.json` to:

```javascript
writeCallbackCallResultsFromJson(jsonText)
```

## Missing Required Field

Skip a response when a template required field is missing or empty:

```json
{
  "responseId": "resp-2",
  "reasons": ["product_interest is required"]
}
```

## Multiple Forms

Use one scheduler plan per form:

```json
{
  "schedulePrompt": "Every day at 6pm",
  "timezone": "Asia/Shanghai",
  "authPreflightOk": true,
  "approvedRealCalls": true,
  "submittedAfter": "2026-05-27T00:00:00Z",
  "templatePath": "skills/google-form-callback/template.md",
  "stateDir": ".callback-state",
  "writebackDir": ".callback-writeback",
  "runDir": ".callback-runs",
  "writebackLocal": true,
  "forms": [
    {
      "formId": "form-1",
      "name": "Commercial Ice Machine Quote Request"
    },
    {
      "formId": "form-2",
      "name": "Walk-in Freezer Quote Request"
    }
  ]
}
```

Render the plans:

```bash
node skills/google-form-callback/scripts/render-runtime-plans.mjs \
  --config schedule-config.json
```
