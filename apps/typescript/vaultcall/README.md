# VaultCall

Autonomous out-of-band BEC wire defense. **No verbal treasury verification, no wire release.**

VaultCall is an enterprise treasury verification console powered by CALL-E (demo simulation). When a vendor bank modification arrives (via invoice email or portal), VaultCall simulates an advisory hold on ERP payment release, resolves the vendor's pre-established corporate PBX line (strictly stripping any phone number found in the incoming email), and deploys CALL-E to conduct a spoken challenge-response with the authorized corporate financial officer.

Verbatim callee utterances are cross-examined against Tax EIN credentials. Unsupported model claims strike through. Valid confirmations mint a SHA-256 audit-fingerprinted **Certificate of Voice Verification** (demo simulation) generating simulated advisory ERP release tokens; fraudulent rejections trigger a simulated emergency fraud freeze for human treasury escalation.

Provider: **CALL-E** (`@call-e/calle` 0.7 / API). Host: local Next.js. English repository-facing UI and errors. Default path is fixture replay. Live calling is opt-in.

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
| **CyberShield Tech** | **Clean Wire Approval ($240,000)** | CFO Sarah Chen verbally validates Tax ID `4891` and authorizes J.P. Morgan account change. Click **Certificate** to view the SHA-256 fingerprinted advisory Wire Release token (demo simulation). |
| **Apex Global Logistics** | **Active BEC Fraud Intercepted ($785,000)** | Attacker spoofed email with burner phone `+1 (305) ***-0144`. Airgap gate intercepts and blocks burner phone; dials PBX Controller Michael Vance. Controller screams fraud! Simulated emergency fraud freeze engaged for controller review. |
| **Meridian Health** | **Gatekeeper / Voicemail Hold ($125,000)** | Receptionist answers stating officer is out of office. Fails closed to **GATEKEEPER HOLD**; never assumes approval from voicemail or unconfirmed calls. |

### Three Dedicated Views for Judges & Evaluators:
- 🌟 **Product Showcase (`/showcase` tab)**: Executive narrative explaining the $55B BEC wire fraud problem, 4-step continuous defense workflow, and real-time trust metrics.
- 📱 **Live Phone Lab (`/studio` tab)**: Interactive handset simulator with animated audio waveforms, live VOIP status, real-time speech simulation, and one-click benchmark presets.
- 🏛️ **Treasury Console (`/console` tab)**: Enterprise audit queue with real-time risk filters, evidence-linked strikethrough inspector, and SHA-256 audit-fingerprinted Certificates of Voice Verification (demo simulation).

### Fast Walkthrough Steps:
1. Switch to **📱 Live Phone Lab**: Select **Apex Global Logistics** ($785,000 BEC attack) and press **Play** on the phone simulator to watch CALL-E catch fraud in real time.
2. Switch to **🏛️ Treasury Console**: Open **CyberShield Tech** and click **View Certificate** to inspect the SHA-256 audit receipt fingerprint with simulated advisory release tokens.
3. Test the **Airgap Scope Matrix**: In the audit modal, see the attacker's fake burner phone `+1 (305) ***-0144` flagged as `STRIPPED BY AIRGAP`.
4. Hit the **Emergency Kill Switch** in the global header to lock down outbound application-boundary dispatches and prevent simulated release token generation (in-flight connected telecom audio cannot be revoked mid-call over telephony protocols).

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
- Strict ASCII E.164 recipient validation and HTTPS origin pinning (`api.heycall-e.com`, `api.call-e.ai`).
- Phone numbers in transcripts, logs, error copies, and certificates are masked.
- Idempotency prevents duplicate call dispatch for identical wire payloads.

---

## Security, Transport & Privacy Architecture

### 1. Pinned HTTPS Transport
All live carrier calls and credentialed transports are strictly pinned to approved HTTPS endpoints:
- `https://api.heycall-e.com`
- `https://api.call-e.ai`
Plaintext HTTP or third-party host redirection attempts are immediately refused.

### 2. Recipient Destination Validation
- Outbound dialing requires strictly valid ASCII E.164 numbers (`/^\+[1-9]\d{6,14}$/`) without spaces, hyphens, parentheses, Unicode digits, or letters.
- Destinations must be explicitly authorized via `ALLOWED_LIVE_RECIPIENTS`, `CALLE_SMOKE_PHONE`, or the verified corporate PBX directory.

### 3. Display Masking & Privacy Preservation
All phone-bearing provider, transcript, error, certificate, audit, and CLI display copies mask middle digits (e.g. `+1 (415) ***-0199` or `+XX ******XXXX`) to prevent telemetry leakage of private recipient phone numbers.

### 4. Fail-Closed Unknown State
Failed or ambiguous live carrier calls (network timeouts, carrier drops, or silence) remain in `GATEKEEPER_HOLD` with `status: UNKNOWN_NO_RECORD`. VaultCall refuses to invent callee speech or generate successful fixture certificates for incomplete live carrier attempts.

### 5. Accepted-Call Cancellation Limits & Kill Switch Scope
This demo does not implement provider-side cancellation of an accepted call. The emergency kill switch rejects new dispatch requests, but an already-running call may finish and publish its simulated certificate or release token. It does not revoke those in-flight results, stop carrier audio, or perform a real ERP or financial mutation.

### 6. Advisory / Simulated Control Scope
VaultCall is a demo simulation of an advisory pre-execution defense architecture. All ERP payment holds, fraud freezes, and generated release tokens are simulated internal control proofs designed for human controller review. No real ERP integrations, live banking wire executions, production treasury mutations, or automated telecom cancellation infrastructure are implemented or guaranteed.

---

## What it is not

- **Not an SMS 2FA tool**: SMS OTPs are routinely intercepted via SIM swapping. Out-of-band conversational challenge-response to a verified corporate PBX is the enterprise gold standard.
- **Not a cold outreach dialer**: VaultCall never initiates outbound calls without an active, high-risk financial modification event in the ERP ledger.
- **Not a conversational chatbot**: The agent follows a strict, single-purpose security script and does not negotiate, alter contracts, or disclose internal company secrets.

---

## How a dial is authorized

1. **ERP Event Ingestion**: Webhook triggers on bank routing/account modification for a pending invoice batch.
2. **Airgap Policy Gate**: Resolves official corporate PBX from hardened registry. If the incoming invoice/email signature included a phone number, it is logged as `disallowed` and strictly discarded.
3. **Challenge Token Compilation**: Generates a NATO challenge token (e.g. `Echo-Sierra-482`) and compiles single-purpose English CALL-E prompt and JSON schema.
4. **Evidence-Linked Scorer**: Every field returned by the extraction model must be grounded in literal callee turns. If the callee does not confirm their Tax ID or states uncertainty, the field is struck through and routes to human treasury escalation.
5. **Audit-Fingerprinted Certificate**: Minted with SHA-256 audit fingerprint upon valid authorization (demo simulation).
