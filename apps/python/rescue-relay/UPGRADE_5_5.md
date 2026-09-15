# Rescue Relay 5.5.0 — goal understanding and CALL-E recovery

## What changed

Goal review now has a semantic contract, not an exhaustive service menu. A configured model can turn a grounded description of success into a proposed goal even when the wording is not an imperative or a recognised action phrase. Its assessment must separately address the reported problem, the animal-welfare mission, and the user's constraints. Approved responders' saved services are supplied as capability context without sending their phone numbers to intake. A missing matching contact is a capability gap, not permission to replace the goal.

The old validator could discard a model-understood outcome when its English action matcher did not recognise the wording, then repeat the same missing-goal question. The semantic path no longer sends a valid model goal through that matcher. Missing semantic assessment is rejected and visibly labelled as fallback rather than represented as model understanding. Restaurant errands such as the burger/mac-and-cheese example are not rescue objectives. Safe medical, location and consent safeguards remain.

The assistant's contextual explanation is kept. Only genuinely missing details require clarification. Optional goal buttons are shown after the response and above the existing free-text box. The main action is **Send** until a reviewed goal has explicitly been selected, then **Confirm goal**. Typing a correction or changing report facts clears the selection; restoring a draft does not restore consent. Selecting a validated goal is local only. Confirming saves the report. **Find help** is a separate action, and approving work remains separate from collecting offers.

The limited offline backup still exists for the fictional demo. It is not a general language model. It now asks the open-ended “What would a successful rescue mean to you?” rather than imposing the old menu on every missing goal. It may offer concrete examples for a genuinely ambiguous check or a conditional stage. If it cannot safely decompose a custom confirmed goal, it pauses instead of inventing a full clinic/transport plan.

## Configure the model

Keep your existing `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. They must refer to a working OpenAI-compatible model. Install the existing requirements in your own virtual environment. For operational use where falling back to limited rules would be misleading, set `LLM_FALLBACK=false`; unavailable or invalid model output then produces an explicit error instead of a rule-based response. Restart after changing settings.

No provider or model credentials are bundled. The displayed **Model assistant** / **Built-in backup** badge distinguishes the engines. Details include the fallback reason. Validation tests use deterministic model-output fixtures; they do not establish the quality of any particular deployed model.

## CALL-E: recover an operation, do not create a replacement accidentally

The application already sent an idempotency header, but it did not durably save the complete original request and it reduced distinct HTTP errors to a generic `HTTPStatusError` message.

Before each first POST, 5.5.0 commits the entire request body, its hash and original key to SQLite. An immutable per-key ledger preserves earlier callback attempts too. The returned top-level Calls API ID is saved immediately. Recovery never regenerates a prompt, timestamp, metadata, schema or recipient:

* **Saved Call ID:** GET that existing operation; no POST is sent.
* **Saved original body and key, but no ID:** explicitly replay that unchanged body with the same key. Do not mint a replacement key. The contact must still be approved and its destination unchanged.
* **Neither:** do not reconstruct the historical request from today's data. Reconcile the old operation before any replacement.

A recovery control is offered for a supported, unresolved saved operation. It is distinct from an intentional new callback after a resolved result. Recovery updates the original record, rechecks its evidence and any approved callback price ceiling, then pauses for review. It never calls the next contact or starts another helper automatically. Stale or duplicate recovery submissions are rejected.

Errors now retain the HTTP status, recognised provider code and create-versus-read phase, with actionable guidance and without echoing secrets or raw provider error bodies. A request rejection is not represented as a completed call. Unknown terminal execution failure fields remain diagnostics rather than being guessed as refusal or no answer.

The historical error supplied in the report does not reveal its HTTP status, provider code or whether create/poll failed. Its exact cause cannot be recovered from that string alone. This update cannot manufacture original request bodies that an older version never saved. A previously saved Calls API ID can still support GET-only recovery.

Official references consulted on 10 September 2026:

- https://docs.heycall-e.com/quickstart
- https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response
- https://docs.heycall-e.com/errors

## Upgrade without losing reports

Stop the old server first. Back up its `.env` and SQLite database while it is stopped. Extract this kit separately, then copy the updated application code into the installation without deleting or overwriting your private `.env` or `data/` directory. Continue using the same `DATABASE_PATH`. Start one server worker normally; migrations add the request ledger and nullable provider fields without deleting existing history.

The new request ledger contains private original request bodies, including recipient phone numbers and report context. Keep database files and backups private. Public API report/run responses omit these original request bodies. Do not include a live database or credentials in a public demo or source archive.

## Verification and retained media

See `docs/VERIFICATION_5_5.md` and `docs/verification/v55/`. Automated tests use local fixtures; no live CALL-E call or external model inference was performed. Native browser-origin/reload enforcement was not verified in the restricted browser environment.

Bundled MP4s, captions and gallery material are retained historical **5.4.0** recordings, not recordings of this patch. The player labels that distinction. The shared recorder journey and written steps have been updated for explicit goal selection and the separate Find help action. Re-record with the supplied scripts when new footage is needed.
