# Google OAuth Setup

Use this reference when configuring the public Google OAuth application for the
local OAuth route.

## Publisher Setup

Create one Google Cloud project for this skill and keep it dedicated to Google
Forms, Google Sheets, and Google Drive metadata access.

1. Create a Google Cloud project.
2. Enable Google Forms API.
3. Enable Google Sheets API.
4. Enable Google Drive API.
5. Configure the OAuth consent screen.
6. Add the minimum scopes:

```text
https://www.googleapis.com/auth/forms.body.readonly
https://www.googleapis.com/auth/forms.responses.readonly
https://www.googleapis.com/auth/drive.metadata.readonly
https://www.googleapis.com/auth/spreadsheets
```

7. Create an OAuth client with application type `Desktop app`.
8. Download the OAuth client JSON.
9. Distribute that JSON as the client configuration for local OAuth, or instruct
   users to save it at:

```text
~/.config/google-form-callback/oauth-client.json
```

Do not commit user OAuth tokens or refresh tokens. The OAuth client identifies
the skill application. The user's local token grants access only for the Google
account that completed the browser authorization flow. The Drive metadata scope
is used only to discover Google Forms files by MIME type; form bodies,
responses, and writeback still use the Forms and Sheets scopes.

## User Setup

The user authorizes their own Google account once:

```bash
node skills/google-form-callback/scripts/google-auth.mjs login \
  --credentials ~/.config/google-form-callback/oauth-client.json
```

After login, agents should check status before processing forms:

```bash
node skills/google-form-callback/scripts/google-auth.mjs status
```

## Verification Notes

For testing, keep the OAuth consent screen in testing mode and add test users.
For public use, sensitive Google scopes may require OAuth app verification.

Keep the project scoped to this workflow. Do not enable billable APIs or runtime
services in the same Google Cloud project unless the product explicitly needs
them.
