# Rescue Relay 5.6.0 — conditional rescue goals and CALL-E readiness

Updated 10 September 2026. This release supersedes 5.5.0 and includes both reported issues. It changes application code and verifies it with local fixtures; it does not establish that CALL-E has successfully dialed your phone.

## 1. Keep IF / THEN / ELSE as one goal

The previous semantic intake still had a deterministic override that treated conditional transport as an unanswered stage-selection question. It could display the correct draft and then ask the user to choose assessment-only or immediate transport. That override is removed. Persisted copies of the obsolete stage question are retired when the whole conditional goal is already understood; a genuinely missing location or an unresolved, specific question still requires an answer.

Both of these are accepted, but they are **not** treated as identical:

- “An on-site veterinary assessment and feeding, with transport to a clinic only if the professional assessment confirms medical necessity.” Feeding is part of the plan, rather than only the ELSE branch.
- “i want a scenario where IF he needs a clinic then transport else just feed him.” Assessment determines the branch. Transport is conditional on clinic care being necessary; feeding is the alternative, not an additional unconditional dispatch.

The second wording is the exact regression supplied in the report. The whole goal is selectable without forcing a choice between its branches. Selecting a reviewed goal is local. **Confirm goal** saves the report; **Find help** collects offers. Neither is approval to begin rescue work.

### Branch-aware planning, not just accepting the text

A plan now carries explicit decisions, named assessment tasks, task gates, and prerequisites. A condition is grounded in the confirmed goal. Validation rejects missing ELSE branches, ungrounded conditions, flattened conditional transport, dangling references, cycles, and incompatible prerequisites. The schema permits up to four decisions and eight tasks; it is not an unrestricted workflow programming language.

The configured model handles semantic decomposition of broader conditional goals. The visibly labelled offline fallback only decomposes a limited medical-assessment / conditional-transport / feeding pattern. Unsupported nested, inverted or different custom fallback plans pause instead of silently becoming immediate transport. A successful fixture test is not a guarantee about the output of a particular deployed model.

Responders are asked for offers covering their assigned start rules and prices, including any standby or unused-branch fees. The complete contingent plan is reviewable before the condition is known. Approval callbacks must confirm those rules and the approved price limit. A helper accepting a conditional task does not establish that its trigger has happened.

The rescue screen records **YES**, **NO**, or an assessment that remains **not recorded**. The reporter explicitly acknowledges that the recorded result came from the assigned responder; it is labelled as reporter-recorded, not independently verified medical evidence. Unknown activates neither branch. Only applicable tasks can progress, and an unused branch is not falsely marked as completed. The rescue cannot close until applicable tasks finish and the user confirms the outcome.

Recording an assessment makes **no phone call**, adds no cost authorization, and records no automatic arrival or completion. Helpers must receive the assigned assessor's result before gated work begins. This release does not add a new automated dispatch call when the reporter records that result. A contradictory assessment cannot silently activate the opposite branch after work may have begun.

## 2. CALL-E HTTP 422 `call_not_ready`

The reported message combined two incompatible conclusions: “create request was rejected” and “use its saved Call ID.” The old error classifier inferred rejection from a general 4xx response, and every HTTP error ended polling immediately.

`call_not_ready` is only the stable code. The accompanying `error.message` and `error.details.questions` can explain the provider-specific cause, such as an unsupported region/language combination. Rescue Relay preserves a redacted, bounded version of those fields for the operator, but the code still does not prove that a Calls API ID was returned, dialing began, or a phone rang.

The corrected handling distinguishes:

| Situation | Application action |
| --- | --- |
| A saved Calls API ID exists | GET that ID only. A `call_not_ready` response is pending, not a new-call failure; continue bounded polling. |
| Creation returns `call_not_ready` without an ID | Keep creation and dialing unconfirmed. Halt after the first POST and reconcile the saved operation; never retry automatically, invent an ID or substitute an attempt ID. Show only redacted, bounded provider guidance. |
| Readiness remains unresolved | Pause, retain the operation and diagnostic, and do not advance to another contact. |
| A different HTTP error occurs | Keep its stable code and phase. Do not automatically replay it through the readiness path. Unknown 4xx responses are not declared definite rejection. |

There is no automatic create replay setting. A create attempt is sent once. If no authoritative top-level Calls API ID is returned, the operation halts for reconciliation even when the provider code is `call_not_ready`. Once a valid ID is returned, it is saved immediately and all subsequent checks are GET-only. IDs found only in arbitrary `error.details` fields remain diagnostic context and are never trusted as a CallTask response.

### The page now explains what is actually saved

A pending known-ID operation offers **Check saved call status**. A no-ID operation offers **Recover original call request**, explicitly warning that creation and dialing are unconfirmed. The review dialog shows the saved ID or “Not saved,” plus the original operation key. Opening or cancelling that dialog sends no request.

Under **Details & history → Conversations → CALL-E request details**, inspect the saved Calls API ID, original key, HTTP status/code/phase, lifecycle status and redacted provider guidance. A queued or in-progress lifecycle state is not presented as proof of ringing.

### Inspect a stuck request without placing a call

The new read-only helper opens the existing SQLite database without creating or modifying it. Run it from `rescue-relay-app/`:

```bash
# Offline: show safe diagnostic fields for the latest saved run.
python scripts/diagnose_calle.py

# Optionally GET saved Call IDs and their lifecycle events. Never POST or replay.
python scripts/diagnose_calle.py --fetch

# Save private provider context locally for troubleshooting.
python scripts/diagnose_calle.py --include-private --output calle-diagnostic-private.json
```

Use `--run-id YOUR_RUN_ID` to choose an older run, or `--database PATH` when the database is elsewhere. `--fetch` reads the existing `CALLE_API_KEY` server setting and refuses to fetch without it. Without a saved ID, fetching is skipped; this script never sends a create request. Output files are created exclusively, with restrictive permissions where supported, and are never overwritten.

The transport now stores a bounded private copy of the provider error body and diagnostic request headers in the database. The configured API key and bearer credentials are redacted. That body can still include recipient or case information, so it is omitted from normal report/run API responses. Review private exports before sharing them with CALL-E support. No diagnostic upload happens automatically.

**Historical limitation:** 5.5.0 discarded the original provider error message/details. This update cannot recover information that was never saved. A further same-operation response can preserve new diagnostic context; creating a new operation merely to obtain diagnostics is not appropriate. If the same `call_not_ready` persists, the specific provider-side readiness problem still needs inspection. This release does not claim to have resolved an account, carrier or provider-side fault without that evidence.

## Upgrade while preserving existing reports

Stop the old server first and back up its `.env` and SQLite database. Extract this kit separately. Replace application code without deleting or overwriting your private `.env`, live database, or `data/` directory. Keep the same `DATABASE_PATH`, then restart one server worker normally.

The database adds a default-empty decision-results field to existing coordination runs. The earlier original-request ledger and provider fields remain. Existing rows are not deleted or reset; conditional branch results are not invented for older runs. A legacy flat plan that conflicts with a conditional goal is flagged rather than silently granted new authorization. Do not reset a live database or restart an unresolved call as a new rescue just to clear an error.

Remote model calls require an exact HTTPS origin listed in `LLM_ALLOWED_ORIGINS`, a base path ending in `/v1`, a model ID and an environment-only key. `https://api.openai.com` is pre-approved. Redirects are disabled, so credentials and case data cannot be forwarded to a second origin. Credential-free loopback `/v1` endpoints remain available for local development; the environment key is never attached to them. `LLM_FALLBACK=false` pauses on unavailable or invalid model output rather than substituting limited rules.

## Verification and limits

See `docs/VERIFICATION_5_6.md` and `docs/verification/v56/` for raw results and current screenshots. All provider/model evidence used in automated checks is local fixture data. No external model inference, real recipient call or carrier-level ringing test was performed. Native browser-origin/storage enforcement was not verified in the restricted environment; browser suites used the declared HTTP bridge. Bundled videos remain labelled historical 5.4.0 recordings.

## Official sources consulted

Accessed 10 September 2026:

- CALL-E error envelopes, stable codes and `call_not_ready`: https://docs.heycall-e.com/errors
- Call IDs, lifecycle states, idempotency and recovery: https://docs.heycall-e.com/calls
- Quickstart: https://docs.heycall-e.com/quickstart

The bounded readiness retry policy and UI are application choices tested locally against those contracts. They are not claims that CALL-E promises a particular readiness delay or that the original reported call reached the telephone network.
