# TRACE — Phone-Verified Operational Claims

> Autonomous phone verification engine for operational supply chains. TRACE verifies whether digital inventory, availability, and order claims match physical reality by conducting structured phone calls through **CALL-E**.

---

## 1. Overview

**TRACE** (_Telephony Reconciliation & Autonomous Claim Evaluation for supply-chain_) takes a digital operational claim, uses **CALL-E** to obtain phone-derived evidence from real-world sources (e.g., supplier desks, dispatchers), deterministically reconciles that evidence against the claim, and records an audit trail.

`Digital Claim → CALL-E Phone Call → Speaker-Aware Evidence → Deterministic Reconciliation → Outcome → Audit Trail`

---

## 2. Problem

Enterprise systems (ERPs, vendor portals, order dashboards) often display stale or inaccurate data:

- Catalog records claim 500 units are on-shelf, but warehouse inventory is depleted.
- Delivery portals promise same-day dispatch for parts on backorder.
- Operational teams waste hours manually calling desks or face line stoppages from stale records.

---

## 3. Solution

TRACE automates phone verification with strict evidence integrity:

1. Ingests a digital claim baseline and targeted questions.
2. CALL-E autonomously calls the supplier and conducts a structured inquiry.
3. Extracts speaker-attributed facts and verbatim quotes.
4. Deterministically calculates discrepancies (Verified Quantity - Claimed Quantity) without LLM hallucinations.
5. Produces actionable recommendations and a multi-sheet audit trail.

---

## 4. Key Features

- **Dynamic Inquiries**: Supports numeric, boolean, text, and multiple-choice verification questions.
- **CALL-E Telephony**: Direct integration with `@call-e/calle` SDK for outbound conversational calls.
- **Deterministic Mock Mode**: Offline simulation provider with 4 canonical benchmark scenarios.
- **Speaker-Aware Extraction**: Strictly isolates AI questions from human answers to prevent self-confirmation.
- **Deterministic Reconciliation**: Rule-based mathematical matrix assigning formal verification outcomes.
- **Multi-Sheet Audit Export**: Exports full 5-sheet Excel workbooks (`.xlsx`), CSV, and JSON records.

---

## 5. How It Works

1. **Task Setup**: Define target organization, E.164 phone number, questions, and claimed quantity/status.
2. **Execution**: CALL-E dials the target (or Mock Provider simulates the call).
3. **Fact Extraction**: Timestamped turns are captured, separating `AI` vs `STAFF` speech.
4. **Reconciliation**: Evaluates physical facts against digital claims using strict equality and delta arithmetic.
5. **Audit Logging**: Saves structured results, transcript turns, and generated recommendations.

---

## 6. Architecture

```text
Frontend (React/Vite) → Backend (Express) → Provider Layer → CALL-E / Mock Provider → Reconciliation → Audit
```

- **`PhoneAgentProvider`**: Abstract interface implemented by:
  - **`CallEProvider`**: Live `@call-e/calle` voice runtime with transcript sanitization.
  - **`MockProvider`**: Local deterministic simulator for zero-cost offline testing.

---

## 7. CALL-E Integration

CALL-E provides the live voice runtime:

- **Outbound Dialing**: Connects to target E.164 phone numbers over carrier networks.
- **Conversational AI**: Executes dynamic task prompts with strict operational guardrails.
- **Structured Answers**: Returns structured JSON answers and transcript turns.
- **Lifecycle**: Backend polls `GET /api/calls/:id` and handles webhook callbacks (`POST /api/calle/webhook`).

---

## 8. Verification Outcomes

| Outcome                      | Condition                                                   | Example                              | Operational Recommendation                          |
| :--------------------------- | :---------------------------------------------------------- | :----------------------------------- | :-------------------------------------------------- |
| **`VERIFIED`**               | Phone evidence confirms claimed status and count.           | Claimed 40, Verified 40 (Δ = 0)      | Maintain schedule; confirm carrier tracking.        |
| **`CONTRADICTED`**           | Phone evidence conflicts with claimed status or count.      | Claimed 500, Verified 320 (Δ = -180) | Issue partial PO for 320; expedite remaining 180.   |
| **`UNKNOWN / INCONCLUSIVE`** | Respondent cannot verify stock, reached wrong line/hotline. | Staff has no inventory access        | Do not rely on claim; flag for manual audit.        |
| **`UNREACHABLE`**            | Call failed to connect, line busy, or no answer.            | 4 unanswered rings                   | Retry in 30 minutes; escalate to secondary contact. |

---

## 9. Evidence Integrity / Trust Model

- **No Self-Confirmation**: The agent's own questions are never parsed as supplier evidence.
- **Speaker Attribution**: Speaker roles (`AI` vs `STAFF`) are strictly preserved in transcript logs.
- **Ambiguity Is Inconclusive**: Unverifiable responses (e.g., test hotlines, wrong departments) strictly yield `UNKNOWN / INCONCLUSIVE` with a `NEEDS_REVIEW` badge.
- **No Phantom Numbers**: Quantities evaluate to `null` unless explicitly stated by the respondent.
- **Phone-Derived Evidence**: Phone confirmations are recorded as phone-derived operational evidence, not absolute physical ground truth.

---

## 10. Requirements

- **Node.js**: `v18.0.0+` (`v20+` recommended)
- **npm**: `v9.0.0+` (workspaces support)
- **CALL-E Account**: API key and active balance (Live Mode only; Mock Mode requires no account).

---

## 11. Installation

```bash
git clone https://github.com/your-org/trace.git
cd trace
npm install
```

---

## 12. Environment Variables

Configure `server/.env` (and optionally `trace/.env`):

```env
PORT=3001
PHONE_PROVIDER_MODE=calle   # 'calle' for live calls, 'mock' for local simulation
CALLE_API_KEY=your_key_here # Required for live calls (also supports CALL_E_API_KEY)
CALLE_WEBHOOK_URL=          # Optional webhook endpoint for async call events
```

---

## 13. Mock Mode

Mock Mode runs locally with zero carrier costs and no API key:

1. Set `PHONE_PROVIDER_MODE=mock` in `server/.env` (or click **Switch** in the UI header).
2. Start development servers:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:5173` and click **Demo Suite** to load benchmark scenarios.

---

## 14. Live Mode

Live Mode dials real telephone numbers through CALL-E:

1. Ensure your CALL-E account has active credits (https://dashboard.heycall-e.com/account/billing).
2. Set `PHONE_PROVIDER_MODE=calle` and `CALLE_API_KEY` in `server/.env`.
3. Build and launch:
   ```bash
   npm run build
   npm run dev
   ```
4. Click **+ New Verification**, enter a target phone number (e.g. `+14155550181`), and trigger the call.

---

## 15. Example Workflow

1. **Digital Claim**: ERP portal shows **500 units** of `STM32H743ZIT6` at supplier _Apex Microelectronics_ (`+1-415-555-0181`).
2. **CALL-E Call**: TRACE calls warehouse desk to verify on-shelf availability.
3. **Supplier Fact**: Representative confirms **320 units** on hand; balance backordered.
4. **Reconciliation**: Discrepancy calculated as **-180 units** → Outcome: **`CONTRADICTED`**.
5. **Recommendation**: Issue partial PO for 320 units immediately; schedule expedited delivery for balance.

---

## 16. Safety / Real-World Side Effects

- **Live Calls**: In Live Mode, TRACE places real calls that consume CALL-E account credits.
- **Target Numbers**: Verify destination numbers before launching calls to avoid reaching unintended parties.
- **Credential Safety**: Never commit API keys or `.env` files to source control.
- **Hotline Detection**: TRACE detects non-inventory hotlines and automatically flags them as `UNKNOWN / INCONCLUSIVE`.

---

## 17. Cancellation / Stopping Calls

Mid-call cancellation from the UI/API is currently not implemented. In-flight calls run until either party disconnects or carrier timeout occurs.

---

## 18. Testing

Run server unit and integration test suites:

```bash
npm test
```

Current test status: **2 test suites passed, 24/24 tests passing** (`reconciliation.test.ts`, `full_product.test.ts`).

---

## 19. Audit Export

- **Excel Workbook (`.xlsx`)**: 5-sheet OpenXML export (`Verification Summary`, `Evidence Chains`, `Question Answers`, `Transcripts`, `Raw Results`) via `GET /api/tasks/export.xlsx` or `GET /api/tasks/:id/export.xlsx`.
- **CSV (`.csv`)**: Tabular summary via `GET /api/tasks/export.csv`.
- **JSON (`.json`)**: Raw audit payload via `GET /api/tasks/export.json`.

---

## 20. Project Structure

```text
trace/
├── client/                     # React 18 + Vite frontend
│   ├── src/components/         # UI components (Transcript, Inspector, Badges)
│   └── src/pages/              # Dashboard, History
├── server/                     # Express + TypeScript backend
│   └── src/
│       ├── providers/          # CallEProvider.ts, MockProvider.ts
│       ├── services/           # reconciliation.ts, callService.ts, exportService.ts
│       └── utils/              # phone.ts, transcript.ts, idempotency.ts
└── data/                       # Local JSON persistence (tasks, idempotency)
```

---

## 21. Project Status

- **Status**: Developer Preview / Community Contribution for CALL-E.
- **Tests**: 24/24 passing unit & integration tests.
- **SDK**: Integrated with `@call-e/calle` v0.7.0.

---

## 22. License

Contributed under the open-source terms of the `awesome-phone-call-agents` repository. Refer to the upstream repository license for details.
