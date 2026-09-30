# Consented local CALL-E verification

**Status of this release: not performed.** No CALL-E key, consenting telephone destination or provider-side evidence was supplied for this session. The fictional videos do not fill this gap.

The official judging criteria assess actual runtime use of CALL-E. Verify the existing live transport before claiming a fully demonstrated provider integration: https://call-e.devpost.com/rules

## Prepare a safe test

Use a separate local installation and database. Arrange a test with your own number or a participant who explicitly agrees to receive an AI call and to any intended recording/transcript use. Confirm current CALL-E setup and account requirements in https://github.com/CALLE-AI/call-e-integrations . Never use emergency services or unsuspecting rescue organisations as test recipients.

Make clear to the participant that this is a fictional coordination exercise: nobody should travel, handle an animal, incur expenses or provide treatment. Use a simple observation-only case for the first test. Do not enable a public endpoint.

## Configure locally

Copy `.env.example` to `.env` in the separate installation and set:

```dotenv
HOST=127.0.0.1
APP_ENV=local
DATABASE_PATH=./data/live-check.db
CALL_MODE=live
ENABLE_LIVE_CALLS=true
CALLE_API_KEY=YOUR_OWN_KEY
LLM_ALLOWED_ORIGINS=
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
LLM_FALLBACK=true
```

`YOUR_OWN_KEY` is a placeholder, not a supplied credential. Keep `.env` private and restart the server. A fresh live database contains no fictional seed contacts. Add only the consenting test contact, their observation capability and permission to receive calls. Enter their genuine E.164 destination, not a demo number.

## Exercise the existing app path

Create a clearly labelled fictional test report with a safe observation-only goal. Review and explicitly confirm it. A successful inquiry should produce a genuine `call_...` provider ID, a terminal provider state and saved recipient transcript turns. Confirm that the actual recipient identity, scope and price/free-of-charge statement are reflected rather than inferred.

Before proceeding to the optional separate helper-confirmation callback, tell the participant again that this is an exercise and no work should begin. Review the selected helper, tasks and limits in the app, then approve deliberately. Check that only the selected contact receives that separate callback. Do not fabricate physical progress or a rescue outcome for a provider smoke test.

For the submission, a screen recording can show the app’s live status and suitably redacted provider-backed result. Obtain permission for any participant content you publish. Keep the original fictional full-flow video labelled Demo; do not edit its badge to Live or swap in invented provider IDs.

## Inspect and export evidence

Use the local API or browser’s network panel to find the real run ID, then:

```bash
python scripts/export_run_artifact.py --run-id run_ACTUAL_ID \
  --out private-evidence/live-check.json
```

The export endpoint omits names, locations and transcripts, but retains provider identifiers. Inspect the output before sharing. Do not include credentials, unmasked numbers, locations or participant transcripts in a public repository. `private-evidence/` is ignored by the release tooling.

Record: test date, app version, purpose, consent confirmation, genuine provider ID, actual terminal status, saved transcript availability and whether the separate callback was tested. Record failures as failures. A local transport/unit test is not a provider-completed call.

## Stop and clean up

If status is uncertain, do not repeatedly press retry. Inspect the saved provider information and your CALL-E account first. The app’s Stop action stops subsequent work; it cannot guarantee that an already submitted external call has ended.

After the exercise, stop the server and return to `CALL_MODE=mock`, `ENABLE_LIVE_CALLS=false`, a blank key and a separate fictional database. Keep any private evidence outside public release folders.
