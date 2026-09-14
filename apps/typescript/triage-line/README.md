# TriageLine

**When disaster strikes, no one should wait by a silent phone.**

When a February 2021 winter storm knocked out power across Texas, **246 people died, and about 60% of them were 60 or older** ([Texas DSHS, via AARP](https://www.aarp.org/livable-communities/tool-kits-resources/info-2022/disaster-risks-to-older-adults.html)). The pattern repeats in nearly every disaster: after Hurricane Katrina, roughly **half of the Louisiana victims were 75 or older** ([Louisiana Dept. of Health](https://ldh.la.gov/assets/docs/katrina/deceasedreports/KatrinaDeaths_082008.pdf)), and the CDC notes that about **80% of older adults live with a chronic condition** ([CDC](https://stacks.cdc.gov/view/cdc/20213/cdc_20213_DS3.txt)) that makes an outage or heat wave far more dangerous. Many die at home, isolated, because no one reached them in time.

The people most at risk are often known in advance, sitting on opt-in registries held by health departments and emergency managers. The bottleneck isn't knowing who to call. **It's the hours it takes humans to actually dial them, one by one.**

TriageLine removes that bottleneck. It's an autonomous welfare-check caller built on [CALL-E](https://www.heycall-e.com/): after a disaster or outage, it phones every affected resident at once, asks if they're safe and what they need, verifies and triages the answers by urgency, and escalates on its own — a call to a GP for anyone who needs help, and a call to an emergency contact for anyone it couldn't reach.

CALL-E makes the phone calls and returns structured results. **TriageLine is the brain on top** — it decides who to call, trusts what comes back only when the evidence supports it, respects consent boundaries, self-heals across language barriers, and turns a welfare check into action.

---

## What it does

One engine drives two call topologies:

- **Fan-out (the welfare roll call).** Call many residents in parallel with the same goal, collect schema-validated answers, triage by urgency, and escalate automatically:
  - reports needing help → **call a GP** to arrange a check-in
  - **silence is the signal** → an unreachable resident (no answer / voicemail) triggers a **call to their emergency contact** to send someone in person
- **Chain (the bureaucratic maze).** Each call's result reveals the next prerequisite and number to dial (clinic → GP → insurer → booked). The call graph grows itself, and a consent policy halts it if a fee comes up.

> The division of labor is the point: **CALL-E handles the telephony; TriageLine handles the graph of calls, the verification of results, and the decisions between calls.**

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
│   Verify · Policy · Escalate    │  CalleClient   │
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

### The value-add layers (our engineering)

1. **Verification** — never trusts CALL-E's `taskCompleted` blindly. Gates on `completionConfidence`, checks required fields are present, and verifies that evidence-bearing values (e.g. a confirmation number) actually appear in the transcript. Unknown never becomes "safe"; untrusted results are downgraded to `needs_review`.
2. **Policy** — consent boundaries encoded into the call task and asserted after the call (e.g. "never agree to a fee"). Violations flag the node as `needs_user` and halt the chain.
3. **Language auto-retry** — if a call returns low confidence with signs of a language barrier, the executor re-dials in the next allowed locale for that region.
4. **Autonomous escalation** — an `expand()` step turns results into follow-up calls: needs-help → GP, and unreachable → emergency contact. A silent phone is escalated, not dropped.

---

## Project structure

```
triageline/
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
│   │   ├── reachback.ts       # fan-out graph + GP / emergency-contact escalation
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
| `GP_PHONE` | Escalation target when a resident needs help |
| `EMERGENCY_CONTACT_PHONE` | Escalation target when a resident is unreachable |

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

TriageLine uses the official **`@call-e/calle` TypeScript SDK** (`src/calle/real-client.ts`), calling `client.calls.createAndWait(...)` and mapping CALL-E's response (status, structured result, confidence, evidence, transcript) into the orchestrator's model.

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

## What's next

- **Hazard playbooks** beyond outages: heat waves, floods, wildfire smoke, and boil-water notices, each with its own triage questions.
- **Risk-ranked dialing** so the highest-risk registry entries (age, medical dependence on power) are called first.
- **Alert-triggered runs** from official feeds (weather services, air-quality indices) instead of a manual start.
- **Durable, resumable runs** backed by a store, so a run survives a restart and never re-dials anyone twice.
- **After-action reports** rebuilt from the append-only event log for emergency managers.

---

## License

MIT
