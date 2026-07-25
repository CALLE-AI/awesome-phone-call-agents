# MedRoute — consent-first pharmacy availability workbench

MedRoute turns a frustrating phone-bound task into a safe, structured workflow: with the user's authorization, it calls selected pharmacies to check a medicine's availability, approximate price, pickup readiness, and closing time—then ranks the responses into a clear shortlist.

It deliberately does **not** provide medical advice, share patient details, place orders, or reserve medication. A licensed clinician or pharmacist remains responsible for medicine suitability.

MedRoute is a runnable Node.js reference app for the [CALL-E](https://www.heycall-e.com/) server SDK. It demonstrates a reusable "call an authorized shortlist, compare factual answers, let a human decide" workflow.

## Why this matters

For time-sensitive medicine, online inventories are frequently incomplete and a patient or caregiver may spend hours calling pharmacies one by one. MedRoute gives care coordinators, family caregivers, and community-health organizations a consent-first way to gather the same facts in parallel.

## CALL-E integration

The live path imports `@call-e/calle` and calls `CalleClient.calls.createAndWait()` with an explicit recipient and schema that produces structured, comparable results. The exact task prompt constrains the agent to factual availability checks and requires it to identify itself.

## Run locally

```bash
npm install
python -m pip install -r requirements.txt
npm start
```

Open `http://localhost:3000`. By default the app is in **demo mode**, which produces deterministic mock call results and never contacts anyone.

To activate the CALL-E code path, place a valid server-side key in `.env` (or your host's environment) as `CALLE_API_KEY`, then select the separate **I authorize the live calls now** checkbox. The default remains safe demo mode.

Completed live calls preserve CALL-E's returned transcript turns alongside the results. Each live pharmacy result with a transcript has a **Download call transcript PDF** button; the same download remains available when opening the saved result later. The authorized pharmacy list is stored locally in the browser, while completed check history is saved server-side in the local `data/` directory.

## Side effects, controls, and cancellation

- The default **Preview availability checks** path is a deterministic dry run. It does not import credentials or place a call.
- A live run happens only after the operator confirms they are authorized to contact the listed pharmacies **and** explicitly selects **I authorize the live calls now**. The app then makes at most five one-off CALL-E calls for that submission.
- Calls require a syntactically valid E.164 number. Public examples use fictional reserved numbers only; do not put real contact details in documentation, commits, or screenshots.
- There are no recurring schedules, background replays, or hidden call jobs. The action button is disabled while a run is in progress to prevent duplicate submissions from the interface.
- A live call already accepted by CALL-E cannot be cancelled from this demo. Closing or refreshing the page does not cancel it. Operators should only submit an authorized call they intend to complete.
- The app does not collect patient data. Its local history and generated PDFs may contain the pharmacy contact and the factual call record, so they should be treated as private operational data and not shared publicly.

## Safety and privacy

- Use only pharmacy phone numbers the operator is authorized to contact, in E.164 format.
- Do not enter patient names, diagnoses, prescription identifiers, payment data, or other personal health information.
- No ordering, holding, payment, or clinical recommendation is permitted.
- Demo numbers are fictional and formatted only to exercise the validation path.
- Keep credentials server-side; `.env` is ignored by Git.

## Verification

```bash
npm run check
npm test
```

The smoke test starts the app without `CALLE_API_KEY`, verifies the ranked demo response, and verifies that a stored transcript can be downloaded as a PDF. It never makes an outbound call.

## Assets

See [ATTRIBUTION.md](ATTRIBUTION.md) for the two visual assets used by the interface and the required phone-animation attribution.

## Demo script (3 minutes)

1. Introduce the real bottleneck: caregivers calling pharmacies one at a time.
2. Enter a medicine and show the explicit authorization gate.
3. Run the safe demo and compare the ranked, schema-shaped results.
4. Show `server.js` and explain the real CALL-E `createAndWait` call plus result schema.
5. Close on boundaries: no medical advice, no PHI, no purchase, always transparent and consent-based.

## Submission checklist

- [ ] Replace demo pharmacies with authorized test recipients for the recorded live-call segment.
- [ ] Record and publish a ~3-minute demo video.
- [ ] Add this app under `apps/typescript/medroute/` in a fork of `CALLE-AI/awesome-phone-call-agents` and open a PR.
- [ ] Add the PR URL, video, and CALL-E account email to Devpost.
