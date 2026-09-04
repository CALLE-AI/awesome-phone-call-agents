# Donor reuse record

E-mploye is an independent application. The donor repository at `C:\Noe\phoenix-command-hackaton` was inspected read-only and is not a dependency of this project.

## Approved reuse boundaries

- `server/state-persistence.mjs`: the atomic JSON snapshot idea was adapted into `server/persistence.mjs`. The module was rewritten for this project and does not import donor code.
- `server/safety-policy.mjs`: the deterministic block/result shape and test philosophy informed the new call-specific policy. Commerce-specific rules were not copied.
- `server/demo-api.mjs` and `src/lib/autonomy-api.ts`: the request-dispatch and retryable API-client patterns informed the new API. Old routes, branding, and session headers were excluded.
- `demo-data.ts`, `demo-engine.mjs`, and `JudgeSandbox.tsx`: used as architecture references only. Their commerce domain, Gemini integration, WhatsApp language, invoice/payment flows, customer data, and old branding are not part of E-mploye.
- The donor's scenario-driven sandbox and explicit approval/event framing informed the new `server/workflow-catalog.mjs`, repeatable demo deck, and shared virtual-employee task model. These were rewritten around CALL-E phone workflows and do not import donor modules.

No donor `.git` history, environment files, build output, archives, private credentials, customer data, or private dependencies were copied.
