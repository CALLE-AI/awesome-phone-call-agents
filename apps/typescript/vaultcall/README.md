# VaultCall

Autonomous out-of-band BEC wire defense. **No verbal treasury verification, no wire release.**

VaultCall is an enterprise treasury verification console powered by CALL-E. When a vendor bank modification arrives (via invoice email or portal), VaultCall halts ERP payment release, resolves the vendor's pre-established corporate PBX line (strictly stripping any phone number found in the incoming email), and deploys CALL-E to conduct a spoken challenge-response with the authorized corporate financial officer.

Verbatim callee utterances are cross-examined against Tax EIN credentials. Unsupported model claims strike through. Valid confirmations mint a cryptographically signed **Certificate of Voice Verification** unlocking ERP wires; fraudulent rejections trigger an emergency account freeze.

Provider: **CALL-E** (`@call-e/calle` 0.7 / API). Host: local Next.js. English only. Default path is fixture replay. Live calling is opt-in.

Contribution area: **User-facing Apps**. Path: `apps/typescript/vaultcall`.

---

## For judges (fast path)

No API key required. No live calls required. Node 20+.

```bash
cd apps/typescript/vaultcall
cp .env.example .env
npm install
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Three seeded benchmark audits are immediately loaded:

| Vendor | Scenario | What to inspect |
| --- | --- | --- |
| **CyberShield Tech** | **Clean Wire Approval ($240,000)** | CFO Sarah Chen verbally validates Tax ID `4891` and authorizes J.P. Morgan account change. Click **Certificate** to view the cryptographically stamped Wire Release token. |
| **Apex Global Logistics** | **Active BEC Fraud Intercepted ($785,000)** | Attacker spoofed email with burner phone `+13055550144`. Airgap gate intercepts and blocks burner phone; dials PBX Controller Michael Vance. Controller screams fraud! Emergency fraud freeze engaged. |
| **Meridian Health** | **Gatekeeper / Voicemail Hold ($125,000)** | Receptionist answers stating officer is out of office. Fails closed to **GATEKEEPER HOLD**; never assumes approval from voicemail. |

### Three Dedicated Views for Judges & Evaluators:
- 🌟 **Product Showcase (`/showcase` tab)**: Executive narrative explaining the $55B BEC wire fraud problem, 4-step continuous defense workflow, and real-time trust metrics.
- 📱 **Live Phone Lab (`/studio` tab)**: Interactive iPhone-style handset simulator with animated audio waveforms, live VOIP status, real-time speech simulation, and one-click benchmark presets.
- 🏛️ **Treasury Console (`/console` tab)**: Enterprise SOX 404 audit queue with real-time risk filters, evidence-linked strikethrough inspector, and cryptographically signed Certificates of Voice Verification.

### Fast Walkthrough Steps:
1. Switch to **📱 Live Phone Lab**: Select **Apex Global Logistics** ($785,000 BEC attack) and press **Play** on the phone simulator to watch CALL-E catch fraud in real time.
2. Switch to **🏛️ Treasury Console**: Open **CyberShield Tech** and click **View Certificate** to inspect the SHA-256 cryptographic SOX 404 audit receipt.
3. Test the **Airgap Scope Matrix**: In the audit modal, see the attacker's fake burner phone `+13055550144` flagged as `STRIPPED BY AIRGAP`.
4. Hit the **Emergency Kill Switch** in the global header to see immediate system-wide dialing lockdown.

## Offline checks

All unit tests and type checks run offline with zero network calls:

```bash
npm test
npm run typecheck
```

The test suite asserts:
- Airgap gate blocks burner phone numbers from malicious invoice payloads.
- Spoken Tax EIN last-4 digits must match before a wire release can occur.
- Unsupported model claims are struck through and fail closed.
- Idempotency prevents duplicate call dispatch for identical wire payloads.

---

## What it is not

- **Not an SMS 2FA tool**: SMS OTPs are routinely intercepted via SIM swapping. Out-of-band conversational challenge-response to a verified corporate PBX is the enterprise gold standard.
- **Not a cold outreach dialer**: VaultCall never initiates outbound calls without an active, high-risk financial modification event in the ERP ledger.
- **Not a conversational chatbot**: The agent follows a strict, single-purpose security script and does not negotiate, alter contracts, or disclose internal company secrets.

---

## How a dial is authorized

1. **ERP Event Ingestion**: Webhook triggers on bank routing/account modification for a pending invoice batch.
2. **Airgap Policy Gate**: Resolves official corporate PBX from hardened registry. If the incoming invoice/email signature included a phone number, it is logged as `disallowed` and strictly discarded.
3. **Challenge Token Compilation**: Generates a NATO challenge token (e.g. `Echo-Sierra-482`) and compiles single-purpose CALL-E prompt and JSON schema.
4. **Evidence-Linked Scorer**: Every field returned by the extraction model must be grounded in literal callee turns. If the callee does not confirm their Tax ID or states uncertainty, the field is struck through and routes to human treasury escalation.
5. **Irrevocable Certificate**: Minted with SHA-256 fingerprint upon valid authorization.
