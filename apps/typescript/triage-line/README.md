# Triage-Line

**Autonomous phone-task orchestrator built on [CALL-E](https://www.heycall-e.com/).**

CALL-E makes real phone calls and returns structured results. **Triage-Line is the brain on top** — it decides who to call, verifies what comes back, enforces consent boundaries, and self-heals across language barriers. One engine drives two call topologies:

- **Fan-out** — call many numbers with the same goal in parallel, collect schema-validated results, triage by urgency, and auto-escalate anyone who needs help.
- **Chain** — each call's result reveals the next prerequisite and the next number to dial. The call graph grows itself.

> The division of labor is the point: **CALL-E handles the telephony; Triage-Line handles the graph of calls, the verification of results, and the decisions between calls.**

---

## Use cases

| Scenario | Topology | Story |
| --- | --- | --- |
| **Reachback** | fan-out | Post-outage welfare check: call every resident, triage who's safe, and automatically escalate anyone who reports needing help to a GP/clinic follow-up call. |
| **Referral Runaround** | chain | Navigate a bureaucratic maze autonomously: clinic → GP → insurer → booked, where each call discovers the next step and number. A consent policy halts the chain if a fee comes up. |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Accessible Web UI (React, no build step)      │
│  goal intake · live activity feed · triage      │
└───────────────┬────────────────────────────────┘
                │ REST + Server-Sent Events (SSE)
┌───────────────▼────────────────────────────────┐
│  Orchestrator (Node / Express / TypeScript)     │
│                                                  │
│   Call Graph ──drives──► Executor                │
│   (nodes, edges)         (fan-out / chain,       │
│        ▲                  bounded concurrency)   │
│        │ results                │                │
│   Verification + Policy         │  CalleClient   │
│   Language auto-retry           ▼  (interface)   │
│                          ┌──────────────┐        │
│                          │ Mock  |  Real │        │
│                          └──────┬────────┘        │
└─────────────────────────────────┼────────────────┘
                                   │ @call-e/calle SDK
                             CALL-E cloud → phones
```

### Core abstractions

- **`CallNode`** — one phone call: number, region/locale, goal, expected result schema, and dependencies (`dependsOn`).
- **`CallGraph`** — nodes plus a mode (`fan_out` / `chain`) and an optional `expand()` that spawns follow-up calls from a completed call's result.
- **`CalleClient`** — the telephony interface. The mock and the real SDK wrapper both implement it, so the executor is agnostic to which one it drives.

### The three value-add layers (our engineering)

1. **Verification** — never trusts CALL-E's `taskCompleted` blindly. Gates on `completionConfidence`, checks required fields are present, and verifies that evidence-bearing values (e.g. a confirmation number) actually appear in the transcript. Downgrades untrusted results to `needs_review`.
2. **Policy** — consent boundaries encoded into the call task and asserted after the call (e.g. "never agree to a fee"). Violations flag the node as `needs_user` and halt the chain.
3. **Language auto-retry** — if a call returns low confidence with signs of a language barrier, the executor re-dials in the next allowed locale for that region.

---

## Project structure

```
triage-line/
├── src/
│   ├── calle/
│   │   ├── client.ts          # CalleClient interface (mock ↔ real swap point)
│   │   ├── real-client.ts     # wraps @call-e/calle SDK
│   │   └── hybrid-client.ts   # routes some nodes to real, rest to mock
│   ├── graph/
│   │   ├── types.ts           # CallNode, CallGraph, verification types
│   │   └── executor.ts        # fan-out + chain runner, concurrency, retry
│   ├── verify/
│   │   ├── verifier.ts        # confidence + evidence-traceability checks
│   │   └── policy.ts          # consent constraints + assertions
│   ├── lang/locales.ts        # region → locale table, retry logic
│   ├── scenarios/
│   │   ├── reachback.ts       # fan-out graph + GP escalation
│   │   └── runaround.ts       # chain graph + expand() rules
│   ├── server/runs.ts         # in-memory run registry + event log
│   ├── server.ts              # Express + SSE + REST
│   ├── env.ts                 # loads .env (first import)
│   └── index.ts               # CLI entrypoint
├── web/                       # accessible single-page UI (React via CDN)
├── mock/calle-mock.ts         # simulated CALL-E for offline dev/demo
├── .env.example               # config template (copy to .env)
└── package.json
```

---

## Getting started

### Prerequisites

- Node.js 18+ (tested on Node 22)
- npm

### Install

```bash
npm install
```

### Configure

Copy the template and fill in values as needed:

```bash
cp .env.example .env
```

`.env` is gitignored — your API key and phone numbers never get committed.

| Variable | Purpose |
| --- | --- |
| `CALL_MODE` | `mock` (default, free), `live` (all real calls), or `hybrid` (some real, rest mock) |
| `CALLE_API_KEY` | Your key from the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys) (needed for `live`/`hybrid`) |
| `CALLE_BASE_URL` | `https://api.heycall-e.com` |
| `MAX_CONCURRENCY` | Max parallel calls in fan-out |
| `MOCK_MIN_DELAY_MS` / `MOCK_MAX_DELAY_MS` | Timelapse: how gradually mock calls complete |
| `REACHBACK_PHONES` | Comma-separated E.164 numbers for real recipients |
| `REACHBACK_REGION` / `REACHBACK_LOCALE` | Region/locale for configured numbers (e.g. `IN` / `en-IN`) |
| `REAL_NODE_IDS` | In hybrid mode, which node ids are placed as real calls |
| `GP_PHONE` | Escalation target for the GP follow-up call |

### Run

**Web UI (recommended):**

```bash
npm run server
# open http://localhost:3000, pick a scenario, press Start
```

**CLI:**

```bash
npm run reachback   # fan-out welfare check
npm run runaround   # referral chain
```

**Typecheck:**

```bash
npm run typecheck
```

---

## HTTP API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/runs` | Start a run: `{ "scenario": "reachback" \| "runaround" }` → `{ id }` |
| `GET` | `/api/runs/:id` | Current run snapshot |
| `GET` | `/api/runs/:id/events` | SSE stream of run events (replays history, then follows live) |
| `POST` | `/api/runs/:id/nodes/:nodeId/approve` | Human review: approve a flagged node → `done` (accepts an optional `{ note }`) |
| `GET` | `/api/health` | Mode and concurrency |

---

## CALL-E integration

Triage-Line uses the official **`@call-e/calle` TypeScript SDK** (`src/calle/real-client.ts`), calling `client.calls.createAndWait(...)` and mapping CALL-E's response (status, structured result, confidence, evidence, transcript) into the orchestrator's model.

**About the mock:** the repository includes a simulated CALL-E client (`mock/calle-mock.ts`). It exists so the multi-recipient orchestration — verification, policy, language retry, escalation, and the live UI timelapse — can be developed and rehearsed **without consuming the account's call quota** or dialing real people during testing. It is a development convenience, not a substitute for the integration:

- `CALL_MODE=live` places every call through the real SDK.
- `CALL_MODE=hybrid` places designated calls (`REAL_NODE_IDS`) for real while the rest are simulated — used in the demo so a genuine CALL-E call runs alongside the mock timelapse.

The live path has been validated against a real phone call end to end (dial → conversation → structured result).

---

## Accessibility

The web UI is built with accessibility in mind: semantic landmarks and headings, a skip link, keyboard-operable controls, an ARIA live region announcing progress, status conveyed by icon **and** text (never color alone), a real data table with scope headers for triage, and reduced-motion support.

> Note: full WCAG conformance requires manual testing with assistive technologies and expert review, which has not been performed.

---

## Limitations & honesty notes

- **Language auto-retry** re-dials once in the next locale, not a full loop over every language.
- The real client's mapping of `voicemail` vs `no_answer` from CALL-E failure codes is best-effort; confirm against live calls if you rely on the distinction.
- International CALL-E regions are primarily for testing; production local lines may require enabling with the CALL-E team.
- Run state is in-memory (no database); restarting the server clears runs.

---

## License

MIT
