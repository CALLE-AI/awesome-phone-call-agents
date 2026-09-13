# Google Forms API

Use this reference when fetching Google Form metadata and responses for
`google-form-callback`.

## Required Payloads

The extraction script needs two JSON payloads:

- form metadata from `GET https://forms.googleapis.com/v1/forms/{formId}`
- responses from `GET https://forms.googleapis.com/v1/forms/{formId}/responses`

The form metadata is used to map question IDs to stable field slugs from item
help text such as `field: phone`.

The responses payload is used to read submitted answers. It should include
`responseId` and the `answers` object keyed by question ID.

## Discovering Forms

Google Forms API operations are form-ID based. When the user asks to process all
accessible forms, discover form IDs through Google Drive first:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action list-forms \
  --output forms.json
```

The local OAuth client uses Drive `files.list` with the Google Forms MIME type
`application/vnd.google-apps.form`, then passes discovered IDs to Forms API.
Use `--form-name-contains` to narrow discovery by title and `--max-forms` to
cap large accounts.

To export all discovered forms for a submitted-time window:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --discover-forms \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

Discovery is available only in the local OAuth route because it requires Google
Drive API access. The Apps Script fallback still expects explicit `formId`
values.

## Submitted-Time Windows

When the user asks for responses from a specific time range, use RFC3339 UTC
timestamps:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "$FORM_ID" \
  --submitted-after "2026-05-26T00:00:00Z" \
  --submitted-before "2026-05-27T00:00:00Z" \
  --output form-export.json
```

`--submitted-after` is inclusive. `--submitted-before` is exclusive. The Google
Forms API supports a lower-bound `timestamp >= N` filter for list requests, so
the local OAuth client sends that filter when available, then applies the upper
bound locally. If only `--submitted-before` is provided, the client must fetch
responses and filter locally.

The Apps Script fallback accepts the same `submittedAfter` and
`submittedBefore` payload fields. It uses `FormApp.getResponses(timestamp)` as a
lower-bound optimization and still filters the final result locally.

## Auth Boundary

Do not ask the user for Google credentials, passwords, OAuth tokens, cookies, or
refresh tokens.

Use an already authenticated Google CLI, host connector, MCP connector, local
OAuth token, or Apps Script workflow. If no authenticated route is available,
stop and ask the user to authorize one.

The preferred portable route is local OAuth:

1. The skill publisher creates a Google OAuth desktop client.
2. The user saves that client JSON locally or points to it with
   `GOOGLE_FORM_CALLBACK_OAUTH_CLIENT_FILE`.
3. The user runs `google-auth.mjs login` once and grants access in the browser.
4. Agents call Google Forms, Sheets, and Drive metadata through
   `google-local-api-client.mjs`; user OAuth tokens stay on the user's machine.

The Apps Script Web App is a fallback route:

1. The user deploys the script once from their Google account and grants Forms,
   Sheets, and Drive permissions.
2. The script exposes a shared-token JSON API for `health`, `export`, and
   `writeback` actions.
3. Agents call the API through `scripts/google-form-api-client.mjs`; they never
   receive Google OAuth credentials.

## Example Fetch Shape

The exact CLI depends on the user's environment. A direct REST route looks like:

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://forms.googleapis.com/v1/forms/$FORM_ID" \
  > form.json

curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://forms.googleapis.com/v1/forms/$FORM_ID/responses" \
  > responses.json
```

Keep `$ACCESS_TOKEN` out of logs, commits, issue comments, and user-facing
summaries.

The local OAuth route avoids Apps Script deployment:

```bash
node skills/google-form-callback/scripts/preflight-auth.mjs --repair-all

node skills/google-form-callback/scripts/google-auth.mjs status

node skills/google-form-callback/scripts/google-auth.mjs login \
  --credentials ~/.config/google-form-callback/oauth-client.json

node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action export \
  --form-id "$FORM_ID" \
  --output form-export.json
```

The Apps Script API fallback avoids local OAuth tokens:

```bash
GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/google-form-api-client.mjs \
  --url "https://script.google.com/macros/s/.../exec" \
  --action health

GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \
node skills/google-form-callback/scripts/google-form-api-client.mjs \
  --url "https://script.google.com/macros/s/.../exec" \
  --action export \
  --form-id "$FORM_ID" \
  --output form-export.json
```

## Reference Form

The reference Google Form can be created from:

```text
forms/callback-request/create-form.gs
```

If an older reference form already exists, use `resetExistingCallbackRequestForm()`
from the same script to replace its questions while keeping the same form ID.

The template source is:

```text
skills/google-form-callback/template.md
```

Use `render-form-script.mjs` after editing `template.md` to produce an updated
Apps Script creator without changing script logic.

Do not commit a user's personal `formId` into the generic skill. Pass `formId`
as runtime input.

## Result Writeback

Google Forms does not support hidden post-call fields on a submitted response.
The local OAuth client writes result records back to the matching row in the
linked response spreadsheet. It adds a `response_id` helper column when needed,
then writes the template-defined result and summary columns in that same row.

The local OAuth route requires `form.linkedSheetId` to exist. If the form does
not have a linked response spreadsheet, link one in Google Forms before using
local writeback, or use the Apps Script fallback because Apps Script can create
and link a response spreadsheet through `FormApp`.

Use this command after a call run writes `callback-writeback.json`:

```bash
node skills/google-form-callback/scripts/google-local-api-client.mjs \
  --action writeback \
  --writeback callback-writeback.json
```

Or let the call processor write back after each approved call run:

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

The Apps Script fallback uses the same writeback model: find the linked response
sheet, add missing helper/result columns, and update the matching response row.

Use this helper after a call run writes `callback-writeback.json`:

```javascript
writeCallbackCallResultsFromJson(jsonText)
```

For direct post-call writeback, deploy the same Apps Script as a Web App:

1. Set `CALLBACK_API_TOKEN` in the script to a private shared value.
2. Deploy the script as a Web App that can be called by the local runtime.
3. Set the same value in the local environment as `GOOGLE_FORM_CALLBACK_API_TOKEN`.
4. Run `process-callback-candidates.mjs` with `--writeback-url <web-app-url>`.

`CALLBACK_WRITEBACK_TOKEN` remains accepted in the Apps Script for older
deployments, but new deployments should use `CALLBACK_API_TOKEN`.

The Web App `doPost(e)` accepts JSON plus the token. With
`action: "writeback"`, it writes the template-defined result and summary columns
into the matching linked response spreadsheet row. With `action: "export"`, it
returns the form metadata, responses, and current result rows in the extraction
script's input shape.
