# Configurable integration architecture

The calling workflow is deliberately separated from business-system integrations.

1. A **provider adapter** discovers external containers, fields, and records.
2. A **binding** stores a runtime-discovered List, Folder, or Space source and maps its primary fields into a normalized workflow item.
3. Every non-empty source field is retained as internal task context. A user can preview/select records, or enable draft refresh when choosing the service. Import never calls anyone.
4. Completed/closed records are excluded at the provider query and checked again during normalization.
5. Recipient-specific records are matched to the explicitly selected contact before they may replace a draft.
6. The existing call review and one-time confirmation gate remains the only way to spend a call credit.
7. An optional, separate write-back action can add the completed call summary as a comment to every source task used in the call.

`manual` is always available. `clickup` is the first remote provider. Adding Odoo, Google Calendar, Airtable, or another system requires a new adapter that implements the same discovery/read contract; CALL-E request construction does not change.

Connection secrets never appear in client responses, workflow JSON, call metadata, or Git. Source IDs, field mappings, source scope, auto-load mode, timezone, locale, and write-back preferences are saved as ordinary settings in D1. No Noon Arch operational ID is embedded in application code.

The hackathon deployment uses a private, per-company personal-token connection because it is the fastest auditable setup. The credential resolver has an explicit auth-mode field so ClickUp OAuth can replace it before opening the product to unrelated public users.
