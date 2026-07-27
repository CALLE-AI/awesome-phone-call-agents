# MedRoute — CALL-E Hackathon Entry

MedRoute turns a frustrating phone-bound task into a safe, structured workflow: with the user's authorization, it calls selected pharmacies to check a medicine's availability, approximate price, pickup readiness, and closing time—then ranks the responses into a clear shortlist.

It deliberately does **not** provide medical advice, share patient details, place orders, or reserve medication. A licensed clinician or pharmacist remains responsible for medicine suitability.

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

To run the app, configure both a valid server-side `CALLE_API_KEY` (only needed for live calls) and a long random `MEDROUTE_ACCESS_TOKEN` in `.env`. Enter the latter in the operator-token field; it is kept only in browser session storage and sent as a Bearer token for API requests. The server requires this token for all stored history and transcript access.

Live calls are Kenya-only (`+254XXXXXXXXX`). The server requires both consent acknowledgements and a stable `Idempotency-Key` header before it will place a live call. The browser creates this key for each deliberate live submission; integrations must retain it when retrying the same request.

Completed live calls preserve CALL-E's returned transcript turns alongside the results. Each live pharmacy result with a transcript has a **Download call transcript PDF** button; the same download remains available when opening the saved result later. The authorized pharmacy list is stored locally in the browser, while completed check history is saved server-side in the local `data/` directory.

## Safety and privacy

- Use only authorized Kenyan pharmacy phone numbers in `+254XXXXXXXXX` format.
- Do not enter patient names, diagnoses, prescription identifiers, payment data, or other personal health information.
- No ordering, holding, payment, or clinical recommendation is permitted.
- Demo numbers are fictional and formatted only to exercise the validation path.
- Keep credentials server-side; `.env` is ignored by Git. Phone numbers are masked in responses, saved history, and transcript PDFs.

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
