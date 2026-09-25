# ClickUp integration research note

Researched on 2026-09-06 from ClickUp's official developer documentation and an authorized development workspace.

## Connection contract

- Base URL: `https://api.clickup.com/api/v2`
- Personal-token authentication: `Authorization: pk_...` (no `Bearer` prefix). ClickUp documents personal tokens for an individual or test integration. Create one at **Avatar → Settings → Apps → API Token → Generate**.
- OAuth authentication: authorization-code flow. Authorize at `https://app.clickup.com/api?client_id={client_id}&redirect_uri={redirect_uri}&state={state}`, exchange the code at `POST https://api.clickup.com/api/v2/oauth/token`, then send `Authorization: Bearer {access_token}`. ClickUp recommends OAuth for applications used by other people. Only Workspace owners or admins can create the OAuth app under **Avatar → Settings → Apps → Create new app**.
- Format: JSON requests and responses.
- Errors: non-2xx responses include a JSON error message and code. Revoked or missing tokens use `OAUTH_*` codes; rate-limit responses use HTTP 429.
- Rate limits are per token: 100 requests/minute on Free Forever, Unlimited, and Business; 1,000 on Business Plus; 10,000 on Enterprise. The 429 response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Read operations required by this app

- `GET /team` — authorized Workspaces.
- `GET /team/{workspace_id}/space?archived=false` — Spaces.
- `GET /space/{space_id}/folder?archived=false` — Folders. Returned subfolders are flat and include `parent_folder`.
- `GET /folder/{folder_id}/list?archived=false` — Lists in a Folder.
- `GET /space/{space_id}/list?archived=false` — folderless Lists.
- `GET /list/{list_id}/field?include_applied_objects=true` — available Custom Fields.
- `GET /folder/{folder_id}/field` and `GET /space/{space_id}/field` — aggregate-scope fields. Task payloads remain the source of truth for List-specific values.
- `GET /team/{workspace_id}/task?page={page}&include_closed=false` with `list_ids[]`, `project_ids[]` (Folders), or `space_ids[]` — active tasks for any supported source scope, up to 100 per zero-based page.
- `GET /list/{list_id}/task?page={page}&include_closed=false&subtasks=true` — backward-compatible fallback for an older saved List binding that predates its saved Workspace ID.
- `GET /task/{task_id}` — one task and its field values.

ClickUp task dates are Unix timestamps in milliseconds. A date-only Custom Field may be returned at 04:00 in the authorized user's timezone, so the connector formats it in the user's configured timezone before producing a calendar date.

## Optional write-back

- `POST /task/{task_id}/comment` with `{ "comment_text": "...", "notify_all": false }` adds a call result to the originating task.
- `POST /task/{task_id}/field/{field_id}` with `{ "value": ... }` updates a Custom Field. The app does not enable this by default because each Free Forever Custom Field update consumes one of the Workspace's limited Custom Field uses.

Write-back is always opt-in and manually confirmed. Importing or refreshing ClickUp data must never create a CALL-E phone call.

## Cross-check request

```bash
curl "https://api.clickup.com/api/v2/team" \
  --header "Authorization: pk_your_personal_token"
```

## Representative schemas verified during development

The test connector confirmed that a workspace can be discovered dynamically. A representative approval/payment source exposed status plus amount, VAT, installment, payment method, contact, phone, and submission date. A meeting source exposed proposed time, objective, location, attendees, and agenda. Employee documents used Folder/List context, due dates, and optional phone fields. Only non-empty values are retained, and operational IDs are deliberately not copied into application code or default settings.

## Sources

- https://developer.clickup.com/docs/authentication
- https://developer.clickup.com/docs/rate-limits
- https://developer.clickup.com/docs/common_errors
- https://developer.clickup.com/reference/getauthorizedteams
- https://developer.clickup.com/reference/getspaces
- https://developer.clickup.com/reference/getfolders
- https://developer.clickup.com/reference/getlists
- https://developer.clickup.com/reference/getfolderlesslists
- https://developer.clickup.com/reference/getaccessiblecustomfields
- https://developer.clickup.com/reference/gettasks
- https://developer.clickup.com/reference/gettask
- https://developer.clickup.com/reference/createtaskcomment
- https://developer.clickup.com/reference/setcustomfieldvalue
- https://developer.clickup.com/docs/webhooks
- https://docs.heycall-e.com/api-reference/calls
- https://github.com/CALLE-AI/call-e-integrations
