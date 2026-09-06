# AttestCall — 2-minute demo script

Target: under 3 minutes (hackathon rules). Run in demo mode so it is reproducible on camera; mention live mode once.

## Setup (before recording)

```bash
cd apps/typescript/attestcall
npm install && npm run build
rm -f data/attestations.log   # clean chain for the demo
npm run dev                    # http://localhost:4600
```

## Beat sheet

**0:00–0:20 — The problem.**
> "Vendor risk teams need point-in-time compliance attestations from third parties. Today that's an email thread producing undated, unverifiable claims. AttestCall gets a real, consented, evidence-grounded attestation over the phone — and seals it into a tamper-evident record."

**0:20–0:45 — Preview, no call.**
- Show the dashboard, note the **DEMO MODE** badge.
- Fields pre-filled: Acme Payments Inc., framework PCI-DSS.
- Click **Preview (no call)**. Point at: masked phone `+1********23`, the idempotency key, and the **disclosed script** ("automated assistant… may be recorded… asks for consent").
> "Nothing has been dialed. An operator sees exactly what will be said first."

**0:45–1:20 — The call → structured result.**
- Click **Place attestation call** (scenario: `compliant`).
> "In live mode this is `client.calls.createAndWait` from the CALL-E SDK — a real phone call. Here it's a deterministic fixture with the exact same result shape."
- Show the green **ATTESTED** result: compliant = yes, cert expiry 2026-11-30, auditor Meridian Assurance, attesting contact, 94% confidence, and the **evidence quotes** grounding it.

**1:20–1:45 — Fail-closed.**
- Change scenario to `low_confidence`, attest again → **NEEDS HUMAN**.
- Then `no_consent` → **NEEDS HUMAN**.
> "AttestCall never treats ambiguity or missing consent as success. Only a clean, consented, high-confidence, evidence-backed 'yes' is attested. Everything else goes to a human."

**1:45–2:15 — The audit chain.**
- Scroll to **Audit chain**: multiple sealed records, each hash-chained.
> "Every outcome is appended to a SHA-256 hash-chained log. Each record's hash covers the previous one, so editing any past record breaks the chain — tamper-evident by construction."
- Optionally in a terminal: `npm run cli -- verify` → `intact: true`.

**2:15–2:40 — Close.**
> "AttestCall turns a compliance question into a dated, evidence-grounded, verifiable record — with the phone call as the actuator. Demo mode needs no credentials, so you can run all sixteen tests and the whole flow yourself. Thanks for watching."

## Terminal-only alternative (if screen-recording the UI is hard)

```bash
npm run cli -- preview --vendor "Acme Payments Inc." --phone +14155550123 --framework PCI-DSS --by "Vendor Risk"
npm run cli -- attest  --vendor "Acme Payments Inc." --phone +14155550123 --framework PCI-DSS --by "Vendor Risk" --scenario compliant
npm run cli -- attest  --vendor "Globex" --phone +442071838750 --framework SOC2-TYPE2 --by "Vendor Risk" --scenario no_consent
npm run cli -- verify
```
