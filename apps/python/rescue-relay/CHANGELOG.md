# Changelog

## 5.6.0 — conditional goals and honest CALL-E readiness

- Remove the conditional-transport stage-choice override; retire its saved question without discarding an understood IF/ELSE goal.
- Carry grounded decisions, gates and prerequisites into responder offers, callbacks, branch-aware progress and closure. Unknown is not NO. Recording a reporter-acknowledged assessment makes no call.
- Treat every unconfirmed create outcome, including `call_not_ready` without an ID, as ambiguous and halt after one POST for reconciliation. Known IDs stay GET-only. Preserve sanitized provider `message` and `details.questions` guidance without exposing credentials or phone numbers.
- Require remote model traffic to use an exact explicitly allowed HTTPS origin and a base path ending in `/v1`; redirects are disabled. The official OpenAI origin is pre-approved. Credential-free loopback development remains available, and loopback clients never receive `LLM_API_KEY`.
- Show whether a Calls API ID actually exists, retain private provider diagnostics outside public API output, and provide a read-only diagnostic script.
- Add conditional end-to-end, mocked-provider, privacy and responsive UI regressions. See UPGRADE_5_6.md and docs/VERIFICATION_5_6.md for results and limitations.

## 5.5.0 — semantic goals, explicit selection and durable CALL-E recovery

Replaces the model-output action whitelist with grounded semantic assessment of the user’s intended outcome, report alignment and application scope. Preserves contextual responses, adds optional goal buttons, and separates Send, explicit selection, Confirm goal and Find help. Shows the actual intake engine and refuses to broaden unfamiliar goals in the offline planner.

Persists original CALL-E bodies and keys before network requests, preserves historical request snapshots, recovers known Call IDs with GET only or replays an unchanged saved body/key, and distinguishes actionable HTTP errors from unresolved call results. Recovery uses the original record and approved terms without cascading to another contact. Additive SQLite migration; no new runtime dependency.

Includes semantic, provider-transport, recovery and browser regressions. Retains old recordings as labelled 5.4.0 material. See UPGRADE_5_5.md and docs/VERIFICATION_5_5.md.

## 5.4.0 — publication polish

Preserves the existing goal, pricing, inquiry, selection, approval, recovery and progress logic. Simplifies the default dashboard and intake copy, adds a clear example entry and direct comparison action, and keeps detailed evidence on demand. Improves draft feedback, quote timing, selected-helper labels and the displayed closing note.

Includes an actual-UI short demo, complete user tutorial, local chapter player, current publishing instructions and regression verification. Corrects the Dockerfile to include every existing runtime Python module. No new database migration or runtime dependency was introduced.

The supplied 5.3.6 archive remains the historical baseline; old patch manifests and duplicate upgrade documents are not part of the clean publication package.
