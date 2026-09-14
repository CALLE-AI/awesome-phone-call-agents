# Avelis — breast follow-up evidence and clinician handoff

A dependency-free Node.js reference for contextual CALL-E conversations, structured observations, transcript evidence, and clinician handoff. Six fictional cases cover breast cancer treatment phases. This is a command-line reference, not the hosted Avelis website.

## Start with real services

Node.js 24 or later. The default entry is **LIVE MODE**, with no bundled credentials. Run `npm start` for setup instructions; it does not dial until you issue the explicit `start` command. Copy `.env.example` to `.env` and supply your own `CALLE_API_KEY`, `AVELIS_PLANNER_KEY`, `AVELIS_PLANNER_MODEL` and authorized `AVELIS_LIVE_PHONE`. The DeepSeek origin is prefilled. Keys and phone numbers are blank. There is no automatic fallback to simulation when configuration or an API fails.

```bash
cp .env.example .env
# Edit .env privately with your own credentials and consenting actor's number.
mkdir -p runs
npm start -- start runs/emma-001 --case bc-emma --allow-call --fictional-roleplay --allow-model-upload
```

This makes a real call and uses your model/provider credits. Read the complete workflow and recovery notes below before starting.

## Explicit offline demonstration

Requires Node.js 24 or later; no installation or API key is needed.

```bash
npm run demo
npm test
npm run preview
node app.mjs --demo --case bc-emma
```

The explicit demo command prints **Demo Simulation**. It uses fictional transcripts, scripted verification, demonstration risk rules and template clinician drafts. Expected risk labels: Emma YELLOW, Nora GREEN, Olivia RED, Ellen YELLOW, Ava YELLOW, Leah GREEN. Emma corrects her symptom timing and side; Ellen leaves timing uncertain; Olivia interrupts the ordinary screen with an urgent concern. GREEN is not a declaration of medical safety.

Preview prints the actual breast-care request prompt and result schema with a masked recipient. It never submits a call. Demo and preview perform no network requests, file writes, notifications or scheduling. Restarting resets all in-memory data.

## Architecture and reusable code

1. `src/breast/records.mjs` and related context modules provide fictional longitudinal clinical context; the exact modules are included under `src/breast/`.
2. `src/followup-planner.mjs` plans contact from orders and history. Explicit, verified patient contact preferences override the model recommendation.
3. `src/breast/prompt.mjs` and `schema.mjs` define identity, emergency screening, treatment branches, dynamic symptom questions and structured observations.
4. `src/calle-http.mjs` builds CALL-E requests and reads **recipient-level** structured results, including when the top-level result is null. It binds the call ID and recipient and avoids mixing evidence from multiple attempts.
5. `workflow.mjs` composes contract checking, bounded extraction repair, semantic verification and DeepSeek risk classification. Unsupported analysis remains UNKNOWN / UNRESOLVED rather than silently becoming GREEN.
6. DeepSeek generates clinician drafts from orders, records, transcript, findings and unanswered questions. A separate model review can request one rewrite; rejected drafts are withheld. Planning and drafts are recommendations only.

The shared modules come from Avelis. The offline path demonstrates fixtures, not live model accuracy. The optional model path below uses actual model generation instead of the offline templates. Neither path executes a clinical action.

## Optional DeepSeek analysis of a fictional case

Copy `.env.example` to `.env`, keep it private, and set `AVELIS_PLANNER_KEY`, `AVELIS_PLANNER_MODEL` to a model available in your account, and `AVELIS_PLANNER_ORIGIN=https://api.deepseek.com`.

```bash
node --env-file=.env app.mjs --case bc-emma --models --fictional-roleplay --allow-model-upload
```

This explicitly authorizes uploading fictional patient context, orders, transcript and proposed extraction to DeepSeek and consumes model credits. No phone number is needed. Model calls use JSON output, a 12-second request timeout, at most three attempts per stage, and bounded backoff; authentication errors are not retried. Several stages may run, including draft review and one rewrite. Errors stay visible in the returned result. No files or tasks are persisted.

## Optional inspection of an existing CALL-E roleplay

Use only a consenting participant's **fictional roleplay** recorded with the matching sample case and breast schema. Do not attach an unrelated real call to a sample patient.

Set `CALLE_API_KEY` and `AVELIS_LIVE_PHONE` to that call's exact authorized E.164 recipient, then:

```bash
node --env-file=.env app.mjs --inspect-call call_YOUR_ID --fictional-roleplay
# Add model analysis only with permission to upload that transcript:
node --env-file=.env app.mjs --inspect-call call_YOUR_ID --case bc-emma --fictional-roleplay --models --allow-model-upload
```

Inspection makes one authenticated GET to `https://api.heycall-e.com`; without `--models`, the output is explicitly unverified provider extraction. With models, the original extraction is retained separately from reviewed output. A completed call and matching breast-schema result are required for analysis; a generic `completed: yes` is insufficient. CALL-E credentials and recipient phone are used for retrieval/binding, not included in model context. The transcript itself may contain identifying words: use fictional roleplay only and obtain permission before uploading or sharing terminal output.

## Complete real-call workflow (explicit opt-in)

`live.mjs` runs the full pipeline using the same planner, context reader, CALL-E request/response adapter, extraction checks, semantic verifier, risk classifier and clinician-script modules used by Avelis Live Mode. The CLI provides a portable filesystem runner; it does not duplicate the hosted UI, authentication, database or background scheduler.

First arrange a consenting adult actor who understands the selected fictional role. Populate your private `.env` with CALL-E and DeepSeek credentials and the separate `AVELIS_LIVE_PHONE`. This value is blank by default and never falls back to another phone environment variable. Start only at the agreed time:

```bash
mkdir -p runs
node --env-file=.env live.mjs start runs/emma-001 --case bc-emma --allow-call --fictional-roleplay --allow-model-upload
```

This command authorizes **one real outbound call** and model uploads, consuming your provider credits. It loads a fresh fictional clinical record without simulated current answers, obtains a personalized contact purpose from DeepSeek, saves the request and unique idempotency key, creates a CALL-E call, polls the saved ID, reads recipient extraction/transcript, verifies evidence, classifies risk, updates local task status and generates/reviews a clinician draft. Future contact plans are recommendations only.

The supplied clinical protocol remains DRAFT. This runner is restricted to supervised fictional roleplay, not real patient care: it uses the existing planner's supervised-test scope with the operator's launch instant, UTC and a test-only 0–24 contact window. The plan must return READY for that exact instant and complete within five minutes or no call is sent. Original fictional medical context is retained; only this test task's due time is set to launch time. The call adds a software-test introduction and consent instructions before the unchanged breast-care prompt. No real hospital affiliation or clinical approval is fabricated. Clinical schedule planning remains in the shared module; this test command does not launch unattended future calls.

### Persistence and recovery

The new run directory is exclusively created with owner-only access (0700 on Unix); `state.private.json` is atomically saved with 0600 permissions. It contains the recipient, original request, key, Call ID, raw response, transcript, analysis and task status. **It contains private data: never commit or upload it.** Credentials are not stored. `runs/` is ignored. On non-Unix systems use account-protected storage; the reference is tested on Unix.

```bash
node --env-file=.env live.mjs resume runs/emma-001 --allow-model-upload
```

- Starting the same directory twice fails before network access. A lock prevents concurrent recovery processes.
- The POST is attempted at most once per directory. Its idempotency key and exact body are saved before submission. A lost response is SUBMISSION_UNKNOWN, not proof of failure; no blind POST retry or new key is generated.
- Resume only reads the saved Call ID. If no ID was saved, it stops: reconcile the original request/key with CALL-E before any replacement. Do not create another directory to bypass uncertainty. See [official recovery guidance](https://docs.heycall-e.com/quickstart).
- Polling performs up to 60 GETs at 10-second intervals per invocation, with a 15-second timeout per GET. A failed GET or exhausted polling window pauses; the remote call may still be running. Resume queries the same call.
- Failed/canceled calls stay UNRESOLVED. Completed calls with missing schema stay ANALYSIS_PAUSED with the raw response available for human review. Provider completion is not proof of successful assessment.
- Partial/failed model analysis is retained. Resume may rerun model analysis and consume additional credits, but never redials. Model retries and draft review are bounded as described above.
- Ctrl+C stops local work, not an accepted provider call. After an abrupt exit, inspect `process.lock` (host and PID), ensure that process has stopped, then remove **only that lock file** before resume. Keep the journal/request; never delete them to force another call.

Console output is a masked status summary. Full results are in the private journal. Exit 0 means the runner reached DONE without an unresolved task, not clinical safety; exit 2 means paused/unresolved and exit 1 means configuration, lock or command failure. Review `stage`, `provider_status`, `task_status` and the saved evidence separately. No provider cancellation, emergency dispatch, automatic redial, clinical notification or recurring scheduling is implemented in this reference. The hosted product's redial worker is outside this package.

`legacy-care-example.mjs` retains the older generic offline care-task example and read-only existing-call inspection. Its optional GET also requires `AVELIS_TEST_PATIENT`; it does not demonstrate the breast schema.

## Safety and scope

The protocol is an unapproved demonstration, not hospital-approved triage. No diagnosis, dosage changes, treatment advice or new investigations. Patient reports do not overwrite prescribed treatment. RED marks priority review; it does not summon help. Models can misinterpret speech or omit findings; source quotes, missing information and human review remain necessary. Offline tests verify implementation behavior, not clinical effectiveness or real-service availability.

Only fictional records and authored transcripts are included. The private website, deployment configuration, databases, real call recordings/transcripts and credentials are excluded. No runtime dependency on the private application exists.

## License

This standalone contribution is licensed under the [MIT License](LICENSE). This grant covers the files in this directory; it does not grant rights to the separate private Avelis application.
