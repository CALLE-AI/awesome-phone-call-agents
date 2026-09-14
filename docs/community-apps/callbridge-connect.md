# CallBridge Connect

CallBridge adds a consented AI phone check-in around a creative-project workflow. Its first pilot is Aura Manager, an AI workspace for creators, artists and founders. The owner reports a deployed signed-in callback form and private queue, and one verified operator-approved Aura callback with a genuine result saved to the matching request. This catalogue entry does not deploy Aura or expose its private source.

- Repository: [Senseiglobal/callbridge-connect](https://github.com/Senseiglobal/callbridge-connect)
- Public demo: [callbridge-connect.onrender.com](https://callbridge-connect.onrender.com/) — fictional inputs and no phone calls; free hosting can sleep and reset samples.
- Demo video: [verified Aura callback, 2:57](https://www.youtube.com/watch?v=FKvPDZw4aMw).
- Evidence: [single-call scope and limitations](https://github.com/Senseiglobal/callbridge-connect/blob/HEAD/docs/VERIFIED-AURA-CALLBACK.md).
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

The signed-in Aura form records a name, phone number, short question and explicit consent for one AI callback. The private operator reads this durable queue; creating a request never dials. The separate fictional demo also supports project-phase/deadline examples. A live call asks about the question or blocker, deadline risk, one next action and any requested human follow-up/window. Results are validated against a schema and saved to the private Aura request after operator-triggered refresh. The customer sees the request status; the operator can review the full brief. The app does not perform a live human transfer, book an appointment, change account entitlements or write creative-project content back into Aura.

## Explicit live-call side effect

Only an authenticated operator's confirmed live dispatch contacts CALL-E to create a real outbound call. This can ring a phone and consume CALL-E credits. Creation, preview, test runs and status refresh never create calls.

Live dispatch requires all of: non-public-demo mode, `CALLE_DRY_RUN=false`, a server API key, a 24+ character operator token and an exact approved-number allowlist. The optional local one-shot Aura worker requires an exact unused request ID and `--approve-real-call`, checks its 24-hour consent window, and binds its process-local allowed destination to that saved request before dispatch. Use only an owned test number or a recipient with explicit consent to this call, in a provider-supported region. The agent is instructed to disclose that it is AI and stop for refusal or a wrong party. One successful conversation does not validate every spoken safety behavior; prompt instructions alone are not a guarantee.

See the [live-test guide](https://github.com/Senseiglobal/callbridge-connect/blob/HEAD/docs/LIVE-TEST.md). The submitted defaults do not dial.

## Credentials and private data

CALL-E keys stay in backend environment variables. Optional Windows helpers store credentials encrypted for the local Windows user under ignored `data/`; no credential values are distributed. The browser uses a separate operator access code in session storage; private deployments require HTTPS. The deployed Aura form uses Aura sign-in and owner-scoped records. The CallBridge queue adapter uses a separate, narrow server-to-server credential, not Aura's database credentials. A legacy creation endpoint is separate and is not required by the signed-in Aura pilot. Secrets are excluded from Git.

Local pilot storage retains the full phone number privately for dialing; API list/detail views mask it, including repeated E.164 values in summaries. Samples use a fictional reserved number. Only three short context fields are accepted. Do not enter passwords, private lyrics or Context Vault records. The app is not a secret detector, encrypted vault or complete retention-management system.

## Cancellation, duplicates and uncertainty

- Before dispatch, an Aura user can cancel their request; an operator can close an eligible non-running request. Cancellation does not stop a call already accepted by the provider.
- Atomic per-request claims and a stable provider idempotency key protect against repeated clicks. There are no automatic redials or recurring jobs.
- A timeout can mean CALL-E accepted the request. The app locks uncertain submissions for human reconciliation instead of resubmitting.
- Refresh fetches an existing run. Failure, missing results and unrecognized states never become completed-success results.
- There is no in-app hang-up control. Stopping the app after CALL-E accepts a request is not a guarantee that a call stops; check provider controls.

## Verification and boundaries

Author-reported verification: 29 no-call Python tests, TypeScript typecheck and a production frontend build passed locally on September 14, 2026. The repository validator also passed after synchronizing this catalogue entry with upstream. The Render fictional create → preview → resolve flow was previously verified. Tests use fake providers and mocked Firestore reads, including consent, duplicate claims, Aura queue boundaries, safe diagnostics and preserving an observed call ID after a storage failure. The separate private Aura repository passed 11 unit/route tests. These tests do not themselves prove telephony.

On September 14, the owner verified one fresh Aura request through the actual SDK adapter, one outbound attempt, a real two-way conversation, and the matching structured result persisted and independently re-read from Aura's private queue. The linked video shows the form, original call audio and completed outcome. This was an operator-approved test with manual result refresh, not unattended production automation. No account allowance was changed or human appointment booked. An older uncertain request remains locked and was not retried. No private call IDs, phone numbers or raw transcripts are included in this contribution. Sample previews remain labelled and are never counted as real completed calls.

This is a single-operator hackathon MVP, not an enterprise service. The private Aura pilot uses its existing durable queue. A separate SQLite deployment needs persistent storage and one service instance. Optional Firestore requires appropriate Google credentials/IAM and has not been verified against a real cloud project. No real-customer, revenue, conversion-improvement or universal regional calling claim is made. Not intended for emergency, medical, legal, financial, political or collections workflows.
