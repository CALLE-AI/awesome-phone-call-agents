# Audition Agent

Audition Agent helps independent filmmakers turn a film into an audition, review
self-tapes, and follow up with shortlisted performers. Its CALL-E workflow explains
an AI-generated role in the producer's own words, asks whether the performer wants
to continue, collects a callback time, and returns unanswered questions to the producer.

**Contribution area: User-facing Apps.** This directory is a catalog and setup guide
for the runnable [Audition Agent application](https://github.com/michi883/audition-agent).
The application source and tests are maintained there under the MIT license.
The instructions below target revision
[`64d5d72`](https://github.com/michi883/audition-agent/tree/64d5d72694d1dd48bd1a0379d215aea3e5050a61).

- [Project description](https://devpost.com/software/audition-agent)
- [Demo video](https://www.youtube.com/watch?v=zGYd7K8DeAA)
- [Full setup and architecture](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/README.md)
- [Demo walkthrough](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/docs/DEMO.md)

## Supported host and CALL-E integration

The app runs locally as a Python 3.12 FastAPI server with a React/TypeScript frontend.
The Strands Producer Agent uses Amazon Bedrock and prepares callback plans through
application tools. CALL-E integration uses the REST API through Python `httpx`:

1. The producer selects a performer and supplies a day, time range, and duration.
2. `plan_callback` persists the exact disclosure, offered windows, masked destination,
   timezone, and a per-intent idempotency key. Planning makes no provider request.
3. The producer reviews the plan and presses **Call**. Agent tools can redisplay or
   cancel a plan, but cannot execute it. Live execution posts one task to `/v1/calls`
   with `recipient_result_schema` and the saved idempotency key.
4. The server polls `GET /v1/calls/{id}`. The structured result includes disclosure
   delivery, continued interest, the chosen window, confidence, evidence, and questions.
5. A callback is marked confirmed only when the result reports disclosure delivery,
   continued interest, an offered window, medium/high confidence, and nonempty evidence,
   without a contradictory disposition. Unanswered questions stay visible for a human.

The evidence check tests presence; it does not independently prove transcript entailment.
Casting choices and production commitments remain with the producer. No calendar event
is created and no performance ranking is performed by the callback workflow.

Relevant source:

| File | Responsibility |
| --- | --- |
| [calle.py](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/backend/app/services/calle.py) | Task text, result schema, REST execution, polling, verification, and simulated results |
| [callback.py](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/backend/app/agent/tools/callback.py) | Saved plans, producer-confirmed execution, cancellation, and workspace updates |
| [test_regressions.py](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/tests/test_regressions.py) | Isolated no-call checks |

## Setup and no-call verification

Use Python 3.12 on macOS or Linux. Clone into a new directory:

```bash
git clone https://github.com/michi883/audition-agent.git
cd audition-agent
git checkout --detach 64d5d72694d1dd48bd1a0379d215aea3e5050a61
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Installing dependencies needs internet access. After installation, these focused
checks use temporary database state and committed fixtures, without AWS credentials,
CALL-E credentials, private media, a frontend build, or live calls:

```bash
PYTHONPATH=backend:tests .venv/bin/python -m unittest -v \
  test_regressions.Regressions.test_agent_confirmation_only_redisplays_plan \
  test_regressions.Regressions.test_callback_requires_evidence_and_an_offered_window \
  test_regressions.Regressions.test_call_mode_defaults_to_mock_even_with_credentials
```

Expected: three tests pass. They check that agent confirmation only shows a plan,
incomplete or contradictory results cannot confirm a callback, and credentials alone
do not enable live calling. The tests force mock mode and replace network connection
attempts with failures. They do not verify a live CALL-E account or carrier connection.

## Run the application in mock mode

The web app additionally requires Node.js 20.19+ or 22+ and npm. From the new clone:

```bash
cp .env.example .env
make seed-offline
AA_CALLE_MODE=mock ./start.sh
```

Open `http://localhost:8000`. The seed command creates nine fictional demo profiles
and handwritten responses; use a dedicated demo database because reseeding replaces
applicants. The launcher installs dependencies and builds the frontend.

Mock mode simulates the phone call and its result without contacting CALL-E. The full
application is not offline: agent chat needs Bedrock, media playback needs accessible
S3 assets, and live ingestion uses cloud services. Configure your AWS region, private
S3 bucket, and credentials as described in the upstream README before exercising those
features. Original films and self-tapes are not distributed; supply permitted media
for playback and tape analysis. The focused checks above work without them.

With AWS configured, open Carla's profile, record the producer's shortlist decision,
then ask: "Call Carla and tell her where Vivi stands. 15 minutes tomorrow between
2:30 and 5 if she's still in." Review the disclosure and windows. Pressing **Call** in
mock mode runs the simulated workflow and updates her profile with a mock result.

For the full upstream regression suite and frontend type-check/build, run `make check`
after the launcher has installed frontend dependencies.

## Opt-in live verification and credentials

1. Obtain your own CALL-E API access using the
   [official integration guide](https://github.com/CALLE-AI/call-e-integrations).
2. In your local, ignored `.env`, set `CALLE_API_KEY` and `DEMO_PHONE_E164` to your own
   phone number in E.164 format. Never commit credentials or a private phone number.
3. Set `AA_TIMEZONE` explicitly and review the producer-written disclosure in
   `backend/app/seed/audition_focus.json`. The supplied disclosure describes the Vivi
   demo role; another production needs its own reviewed terms.
4. Stop the server, then start it with `AA_CALLE_MODE=live ./start.sh`. The mode defaults
   to mock; `AA_CALLE_MODE` overrides `DEMO_MODE`. Live mode requires both the CALL-E
   key and demo destination. Inspect the plan's masked destination and demo label.
5. Prepare a new plan, review it, and press **Call** only when ready to receive the call
   on your own phone. Answer as the fictional performer. The AI identifies itself,
   reads the disclosure, asks about continued interest and an offered time, and takes
   questions for the producer.
6. Inspect the returned result in the profile. Report incomplete or failed results as
   such; a mock run is not evidence of a live call. Return to
   `AA_CALLE_MODE=mock ./start.sh` for rehearsals.

CALL-E credentials remain on the server. AWS credentials use the standard boto3
credential chain. A Gemini key is optional for video analysis. Live cloud use can incur
charges; no live call is needed for the default verification path.

## Side effects, cancellation, and boundaries

- Planning writes local database and event state. Producer-confirmed live execution
  sends the task, destination, and schema to CALL-E and places a real outbound call.
  Returned call information is stored locally. Keep real performer data private.
- Use the supplied demo with your own phone. For real performers, obtain permission
  to contact them for this purpose; producer approval alone does not establish that
  permission. Plan summaries mask the destination.
- Cancel an unexecuted plan using the plan card's cancel action or ask the agent to
  cancel it. Plans expire after 15 minutes by default. There are no recurring jobs.
- Stop the local app with **Ctrl+C** or `./stop.sh`. Once submitted, this app has no
  active-call cancellation API. Stopping the server or reaching the polling timeout
  does not cancel a provider call; the recipient can end the call. Inspect CALL-E's
  call state before retrying an interrupted or ambiguous submission.
- Execution uses the saved intent's idempotency key and state checks to avoid repeat
  submissions of that intent. Creating a new plan is a distinct intent; reconcile an
  uncertain call before creating another. Ambiguous submissions are not auto-redialed.
- Calls convey the producer's reviewed terms and route unresolved questions back to
  a human. They do not negotiate contracts or provide medical, legal, financial, or
  emergency advice. They do not make hiring or casting decisions.
- This is a local, single-producer prototype without authentication or tenant
  isolation. Bind to localhost. Public hosting requires access controls for producer,
  upload, reset, and call endpoints. Background jobs and polling are in-process;
  interrupted calls may need manual reconciliation.

## License and assets

The [source license](https://github.com/michi883/audition-agent/blob/64d5d72694d1dd48bd1a0379d215aea3e5050a61/LICENSE)
is MIT. Demo profiles and portraits are illustrative fixtures. Private films, self-tapes,
real call recordings, and transcripts are not included in this contribution. The source
license does not grant rights to third-party media.
