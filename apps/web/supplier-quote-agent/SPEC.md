# call-e: Supplier Quote Agent — SPEC

## Customer Confusion

Procurement teams spend hours calling multiple vendors to compare prices, availability, and payment terms for supplies. Each vendor has different processes—some require callbacks, others have wait times, and manually tracking quotes across spreadsheets is error-prone. Teams cannot reliably qualify leads or auto-escalate to a human until they understand supplier response patterns.

## Concept

A procurement agent makes outbound calls to suppliers requesting quotes on specified products (qty, SKU, delivery timeline), parses structured responses (price, lead time, terms), and stores results in a live dashboard. The agent never commits to an order—humans approve any purchase before the call ends. The dashboard shows quote comparison (sorted by price/lead time), call status (pending/completed/failed), and full transcripts with speaker turns for audit.

## Tools & Features

### `call_supplier`
- **What it does:** Initiate an outbound call to a supplier phone number, specify product(s) and required info (unit price, delivery date, MOQ), receive structured JSON response with price, lead time, payment terms, and confidence score.
- **What it does NOT do:** Commit to orders, negotiate pricing beyond the initial inquiry, handle disputes or cancellations, process payments.

### `get_quote_status`
- **What it does:** Retrieve call status (pending/completed/failed), partial transcript, and current result schema match confidence. Supports polling for async calls.
- **What it does NOT do:** Predict pricing, suggest vendors, or provide procurement advice.

### `store_quote_result`
- **What it does:** Save structured quote data (supplier name, phone, SKU, price, lead time, MOQ, confidence, raw transcript). Upsert by supplier+SKU for idempotency.
- **What it does NOT do:** Validate pricing against contracts, flag outliers, or trigger purchase orders.

### `list_pending_quotes`
- **What it does:** Return list of suppliers still pending callback, sorted by deadline. Surfaces call plan briefs authored by the user.
- **What it does NOT do:** Auto-retry failed calls or modify pending quote requests.

### `request_human_approval`
- **What it does:** Pause the agent, surface the top 3 quotes + full call transcripts, and wait for human confirmation (approve / reject / retry with different terms) before returning to agent.
- **What it does NOT do:** Make purchase decisions, contact suppliers, or commit budget.

## Data Model

```json
{
  "quote_id": "q_abc123",
  "supplier_name": "Acme Corp",
  "phone": "+1-555-0123",
  "sku": "WIDGET-42",
  "quantity": 100,
  "price_per_unit": 12.50,
  "total_price": 1250.00,
  "lead_time_days": 5,
  "moq": 50,
  "payment_terms": "Net 30",
  "confidence_score": 0.92,
  "call_id": "call_xyz789",
  "transcript": [
    { "speaker": "agent", "text": "Hi, I'm calling to request a quote for…", "timestamp": "2026-09-08T12:00:00Z" },
    { "speaker": "supplier", "text": "Thank you for calling. Let me check…", "timestamp": "2026-09-08T12:00:15Z" }
  ],
  "status": "completed",
  "requested_at": "2026-09-08T11:55:00Z",
  "completed_at": "2026-09-08T12:05:00Z"
}
```

## Demo Script

**Judge sees (60 seconds):**

1. **Setup:** User creates a quote request in the dashboard: "Get price quotes for Widget-42 (qty 100, deliver by Sep 15)" from 3 suppliers (Acme Corp, TechVend Inc, Global Parts Ltd).
2. **Agent runs:** Agent calls each supplier in sequence, plays recorded plan brief ("I'm an AI agent calling on behalf of Acme Procurement…"), requests structured pricing info, stores results.
3. **Live dashboard:** As each call completes, quotes appear in real-time sorted by price. Judge sees full transcript from at least one call (with speaker turns, timestamps).
4. **Human gate:** Agent surfaces top 2 quotes to user with approve/reject options. User approves the cheapest option. Agent never contacts supplier again—approval is only recorded in dashboard.
5. **Results:** Dashboard shows all 3 quotes, 1 approved, call success rate, and export-ready CSV.

## Stack Pin

- **Runtime:** Node.js 20 LTS
- **Package manager:** npm
- **Framework:** Express.js (backend) + React (frontend dashboard)
- **Test runner:** Jest
- **Linter:** ESLint
- **CALL-E integration:** REST Calls API (`https://api.heycall-e.com/v1/calls`), static
  API-key auth — corrected 2026-09-13 from an earlier MCP-endpoint plan that turned out
  to need OAuth, not a static key; see `README.md`'s "Credentials and real calls"

## Agent Surface

- **How the agent reaches tools:** Through a registered MCP server that exposes the five tools above. Agent authenticates via CALL-E CLI using a user-provided API key (no hardcoded credentials). The CLI handles token caching and tool discovery.
- **What runs the agent:** User runs `npm run agent <quote-request-id>` which spawns a Claude agent in an agentic loop (using Tool Runner or equivalent). The agent receives the quote request, plans calls, executes them sequentially, and reports results back to the dashboard API.
- **Demo runtime:** Local Node.js process with a fake CALL-E provider that returns canned JSON responses (no real calls charged during development/demo).

## Plan Brief Authorship

- **Who writes it:** The user via dashboard text field when creating a quote request. Example: "You are a procurement AI calling on behalf of Acme Procurement. Introduce yourself, request unit price for WIDGET-42, ask for lead time and MOQ. Thank the supplier and end the call."
- **How it's used:** Agent receives this text as part of the `call_supplier` tool's description; CALL-E includes it in the call's context for the AI on the receiving end.

## File Layout

As built (this replaces the layout originally planned here; `src/agent.js` was never
needed once the agent surface became the HTTP tool registry, and the test files landed
under different names):

```
entries/call-e/
├── README.md                    # What it is, safety, setup/run/test/lint, demo walkthrough
├── LICENSE                      # MIT
├── SPEC.md                      # This file
├── package.json                 # Dependencies, scripts
├── verify.sh                    # Docs present, then npm test && npm run lint
├── docs/
│   ├── architecture.md         # Diagrams + the three-layer approval gate
│   ├── architecture.svg        # Exported request-path diagram
│   ├── task-lifecycle.svg      # Exported state machine
│   ├── submission.md           # Devpost write-up
│   ├── video-script.md         # Demo video narration, shot list, timings
│   ├── submission-checklist.md # This checklist, line by line, with evidence
│   └── pr-body.md              # PR body for awesome-phone-call-agents (template only)
├── src/
│   ├── server.js               # Express backend, API routes
│   ├── invoke.js               # The single invoke(tool, args, actor) chokepoint
│   ├── store.js                # In-memory tasks + quotes, seeded
│   ├── tools.js                # Agent-facing tool registry (9 tools)
│   ├── mask.js                 # Phone masking for every HTTP response
│   ├── fictional-numbers.js    # Ranges reserved for fiction (samples; refused live)
│   ├── local-only.js           # Loopback-only request guard
│   ├── dashboard.jsx           # React frontend component (readable source)
│   └── providers/
│       ├── call-provider.js    # Base class + shared status sequence
│       ├── fake-call-provider.js  # Default: deterministic, no network
│       ├── calle-provider.js   # Real CALL-E integration (never the default)
│       └── index.js            # getProvider() factory
├── public/
│   └── index.html              # What npm start serves (React from CDN, no build step)
├── tests/
│   ├── approval-gate.test.js   # The thesis: no tool can approve
│   ├── demo-script.test.js     # The Demo Script above, end to end
│   ├── call-flow.test.js       # plan -> approve -> place -> outcome
│   ├── providers.test.js       # Both providers; CallEProvider on fixtures + loopback only
│   ├── invoke.test.js          # The chokepoint itself
│   ├── store.test.js           # Seeded state, quote upsert
│   ├── mask.test.js            # Masking: known numbers, free text, round-trips, cost
│   ├── server-http.test.js     # The real Express app over a loopback socket
│   ├── server-boot.test.js     # Real-provider misconfiguration stops startup
│   ├── local-only.test.js      # Loopback-only guard
│   ├── invoke-provider-security.test.js  # No request can reconfigure the real provider
│   ├── fictional-numbers.test.js         # Every +/00/011 number is fictional
│   ├── non-phone-digit-runs.test.js      # Every other phone-like run: fictional or listed
│   ├── helpers/
│   │   └── repo-numbers.js     # The +/00/011 scan both guards share
│   └── fixtures/
│       ├── calle-responses.json
│       └── non-phone-digit-runs.json
└── fake-provider/
    └── canned-responses.json   # Fake CALL-E outcomes for the demo
```

## Test Plan

- **Fake provider:** `fake-provider/canned-responses.json` returns pre-recorded call responses (3 different supplier quotes, including 1 failure case). Tests do NOT make real calls.
- **Agent loop test:** Verify agent receives quote request, calls each supplier tool sequentially, parses responses, and updates dashboard.
- **Tool mock test:** Mock MCP tool responses; verify `store_quote_result` deduplicates by supplier+SKU, `request_human_approval` pauses agent and waits for callback.
- **Dashboard test:** Verify quotes render sorted by price, transcripts display with speaker turns, human approval button triggers callback.

## PR Target & File Set

**Target repository:** https://github.com/CALLE-AI/awesome-phone-call-agents

**Target directory:** `apps/web/supplier-quote-agent/`

> Corrected against the target repo, September 2026. This spec originally said
> `apps/typescript/`, but the app is plain JavaScript on Node with a browser dashboard,
> and `apps/web/` is where that repo keeps its other JavaScript/Node app. Their
> `CONTRIBUTING.md` asks for `apps/<language-or-runtime>/<app-name>/`. Either location
> passes their validator — see `docs/pr-body.md`.

**Files in PR:**
- All files in `entries/call-e/` (package.json, src/, public/, tests/, fake-provider/, docs/, verify.sh)
- No files outside `entries/call-e/` are committed to the target repo

**Naming convention:** Follow git-naming-conventions.md in awesome-phone-call-agents (branch: `feat/supplier-quote-agent`, commit: "feat(apps): add supplier quote agent")

> Corrected against the target repo, September 2026. This spec originally said
> `feature/supplier-quote-agent`, which their own `scripts/check_branch_name.py`
> **rejects** — the allowed types are `feat|fix|docs|chore|refactor|test|ci|build|
> release|hotfix|spike`. Verified output is in `docs/pr-body.md`.

## Submission Checklist

The following checklist is copied verbatim from the CALL-E hackathon rules at https://call-e.devpost.com/:

> **Evidence for every line — including the ones only the owner can do — is in
> [`docs/submission-checklist.md`](docs/submission-checklist.md).** Unticked boxes below
> are owner-only steps tracked on issue #9, not gaps in the entry.

### Required Submissions

- [ ] Open a pull request to the [awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents) repository following the directory and file naming conventions in `docs/git-naming-conventions.md`
- [ ] Provide the pull request URL on the Devpost submission form
- [ ] Submit a demonstration video approximately 3 minutes in length, uploaded to YouTube or Vimeo and made publicly visible
- [ ] Include your CALL-E account email address

### Optional Components

- [ ] Provide a URL to a functional demo application (if applicable)
- [ ] Complete the feedback survey (eligible for Most Valuable Feedback prizes)

### Additional Requirements

- [x] All project code and documentation must be in English
- [x] Use only fictional or masked phone numbers in samples and tests (no real contact information)
- [x] Include setup and installation instructions
- [x] Document safety notes for real-world side effects (e.g., actual outbound calls)
- [x] Provide cancellation or rollback procedures for recurring workflows (if applicable)
- [x] No secrets, API keys, or personal data in the repository
- [x] Run validation: `python3 scripts/validate_repository.py` in the awesome-phone-call-agents repo (passes without warnings)

---

**Deadline:** September 14, 2026, 11:45 PM SGT (https://call-e.devpost.com/)

**Prizes:**
- Most Practical Use Case: $4,000 + meeting + blog feature + 20,000 credits
- Most Innovative Use Case: $3,000 + meeting + blog feature + 20,000 credits
- Honorable Mention (2 winners): $1,000 each + meeting + blog + 10,000 credits
- Most Valuable Feedback (5 winners): $200 + 10,000 credits

**Total Prize Pool:** $10,000
