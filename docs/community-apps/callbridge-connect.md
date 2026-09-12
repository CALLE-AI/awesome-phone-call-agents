# CallBridge Connect

CallBridge adds a consented AI phone check-in around a creative-project workflow. The first example integration is Aura Manager, an AI workspace for creative projects. That website integration is proposed, not deployed by this contribution.

- Repository: [Senseiglobal/callbridge-connect](https://github.com/Senseiglobal/callbridge-connect)
- Public demo: [callbridge-connect.onrender.com](https://callbridge-connect.onrender.com/) — fictional inputs and no phone calls; free hosting can sleep and reset samples.
- License: MIT
- Runtime: Python 3.12+, React/TypeScript, Node.js 22+, Bun; optional Docker.
- CALL-E integration: official public `calle-ai` Python SDK (`calls.create`, `calls.get`).

The complete app lives in its own repository. This is a community-app catalogue entry, not a CALL-E SDK or supported product API.

## Safe setup and usage

```sh
git clone https://github.com/Senseiglobal/callbridge-connect.git
cd callbridge-connect
docker build -t callbridge .
docker run --rm -p 8080:8080 callbridge
```

Open `http://localhost:8080`, choose **New check-in**, create a fictional sample, then choose **Preview callback**. No account or CALL-E credential is needed. The container defaults to public demo mode: only fictional sample requests, ephemeral in-memory storage and live calls disabled.

Without Docker, the [project README](https://github.com/Senseiglobal/callbridge-connect#develop-locally) documents separate Python and React development servers. To verify the backend without calls:

```sh
python -m pip install -r apps/python/callbridge/requirements.txt
python -m unittest discover -s apps/python/callbridge -v
```

## Workflow and result

The request records consent, phone number, project phase, project deadline and the creator's stated blocker. The live call asks about that blocker, deadline risk, one next action and any requested human follow-up/window. Results are validated against a schema and reviewed by an operator. The app does not perform a live human transfer, book an appointment, change accounts or write into Aura automatically.

## Explicit live-call side effect

Only an authenticated operator's confirmed live dispatch contacts CALL-E to create a real outbound call. This can ring a phone and consume CALL-E credits. Creation, preview, test runs and status refresh never create calls.

Live dispatch requires all of: non-public-demo mode, `CALLE_DRY_RUN=false`, a server API key, a 24+ character operator token and an exact approved-number allowlist. Use an owned test number or a recipient with explicit consent to this call. The agent is instructed to disclose that it is AI and stop for refusal or a wrong party. Spoken behavior still needs live validation; prompt instructions alone are not a guarantee.

See the [live-test guide](https://github.com/Senseiglobal/callbridge-connect/blob/HEAD/docs/LIVE-TEST.md). The submitted defaults do not dial.

## Credentials and private data

CALL-E keys stay in backend environment variables. The browser uses a separate operator access code in session storage; private deployments require HTTPS. The Aura creation endpoint uses its own server-to-server bearer token. Secrets are excluded from Git.

Local pilot storage retains the full phone number privately for dialing; API list/detail views mask it, including repeated E.164 values in summaries. Samples use a fictional reserved number. Only three short context fields are accepted. Do not enter passwords, private lyrics or Context Vault records. The app is not a secret detector, encrypted vault or complete retention-management system.

## Cancellation, duplicates and uncertainty

- Before dispatch, cancel the confirmation or resolve the request to prevent its later dispatch.
- Atomic per-request claims and a stable provider idempotency key protect against repeated clicks. There are no automatic redials or recurring jobs.
- A timeout can mean CALL-E accepted the request. The app locks uncertain submissions for human reconciliation instead of resubmitting.
- Refresh fetches an existing run. Failure, missing results and unrecognized states never become completed-success results.
- There is no in-app hang-up control. Stopping the app after CALL-E accepts a request is not a guarantee that a call stops; check provider controls.

## Verification and boundaries

Local verification: 18 no-call backend tests, TypeScript typecheck and production frontend build. Tests use fake providers and mocked Firestore reads, including coverage for the general creative-project profile and legacy deadline inputs. The Docker app was deployed on Render's Free plan on September 12, 2026; its hosted fictional create → preview → resolve workflow and no-call health flags were verified. Live CALL-E call evidence and the owner's demo video remain pending. Sample previews are labelled and never counted as real completed calls.

This is a single-operator hackathon MVP. SQLite needs persistent storage and one service instance for a live pilot. Optional Firestore requires appropriate Google credentials/IAM and has not been verified against a real cloud project. No real-customer, revenue or conversion-improvement claim is made. Not intended for emergency, medical, legal, financial, political or collections workflows.
