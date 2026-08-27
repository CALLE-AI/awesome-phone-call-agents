# Future Marketplace Migration Notes

This file is future reference material and is not an implementation target for the current private/static app. The current app has no external backend, OAuth flow, durable candidate state, or HubSpot CRM writeback.

HubSpot Projects `2026.03` serverless functions support static-auth private apps. HubSpot documents that serverless functions in this path do not currently support OAuth authentication. Marketplace apps should use OAuth and should not rely on this scaffold as-is for public distribution.

## What Changes For Marketplace

Replace the private serverless runtime with an external backend that owns:

- HubSpot OAuth install and token refresh.
- Workflow action endpoint hosting.
- App Card backend endpoints.
- CALL-E API credentials.
- Durable per-tenant idempotency storage.
- Tenant isolation across HubSpot portals.

Keep these assets from the private scaffold:

- workflow action field model
- CALL-E metadata and idempotency contract
- App Card user flow
- safety and cancellation behavior

CRM result synchronization would be a separate future feature requiring explicit HubSpot write scopes, a documented data contract, and an additional safety review. It is not provided by this repository's deployable HubSpot project.

## Marketplace Discovery Path

The Marketplace version should expose:

- app listing for `CALL-E for HubSpot`
- workflow action visible in the HubSpot action selection panel
- Contact App Cards first; add Deal support only after defining a portable Deal phone-property or associated-Contact contract, with ticket support evaluated as a later Marketplace expansion
- setup documentation for phone property mapping and approval-first operation
- privacy, security, and support documentation

## Migration Checklist

1. Create a HubSpot OAuth app configuration.
2. Move workflow `actionUrl` to the external backend.
3. Replace static-auth HubSpot API calls with per-portal OAuth access tokens.
4. Store idempotency state in durable external storage.
5. Verify duplicate prevention across retries.
6. Complete HubSpot app card review and Marketplace listing requirements.
7. Run a fresh security review of phone-number masking, credential storage, and explicit call intent.
