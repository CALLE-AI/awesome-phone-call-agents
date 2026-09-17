# Mazō — Autonomous AI Executive Coach

> **Turn overthinking into decisive action.** Mazō is a proactive executive coaching agent that initiates real-time phone calls via **CALL-E** to conduct high-leverage accountability sessions, unblock strategic decisions, and formulate structured action plans.

[![Platform: CALL-E](https://img.shields.io/badge/Platform-CALL--E-000000.svg)](https://heycall-e.com)
[![Runtime: Node / TypeScript](https://img.shields.io/badge/Runtime-TypeScript%20%7C%20Node.js-3178C6.svg)](https://www.typescriptlang.org/)
[![Safety: Consent-First](https://img.shields.io/badge/Safety-Dry--Run%20%26%20Consent%20First-10B981.svg)](#safety-model--operational-guardrails)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌟 Executive Summary

Most productivity tools and AI chatbots fail for one fundamental reason: **they are passive.** 

When a user closes their chat window or laptop, intentions dissolve into procrastination. Text-based AI coaches wait for you to open the app; if you are stuck, overwhelmed, or avoiding a difficult task, you simply don’t open it.

**Mazō redefines AI coaching by picking up the phone.**

Powered by **CALL-E's autonomous telephony engine**, Mazō proactively calls founders, executives, and high performers at scheduled intervals or critical moments. Over a structured 3-to-5 minute phone conversation, Mazō:
1. Pinpoints current bottlenecks and decision paralysis.
2. Applies structured executive coaching frameworks.
3. Secures a concrete, actionable commitment.
4. Formulates a focused execution plan to unblock forward progress.

---

## 🛑 Not an Open-Ended Chatbot: An Extraction & Planning Engine

Most conversational AI assistants suffer from **"infinite conversation syndrome"**—they invite endless back-and-forth rambling, open-ended chit-chat, and pseudo-productivity that delays actual execution. 

**Mazō is fundamentally different: It is NOT an open-ended chatbot.**

Mazō is designed as a **strictly bounded, cognitive extraction and planning pipeline** to move from confusion to execution in under 5 minutes:

### 1. Active Intent & Friction Extraction
Mazō does not wait for you to compose a structured prompt. Instead, it actively interviews you, extracts raw thoughts, and filters out cognitive noise to isolate:
- **The True Bottleneck**: What is actually blocking forward progress vs. manufactured urgency?
- **Core Priority Milestone**: The single highest-leverage outcome required today.
- **Hidden Obstacles & Assumptions**: Unspoken fears, perfectionism loops, or dependency blockers.

### 2. Concrete Plan Formulation (Not Endless Brainstorming)
Once the problem is extracted, Mazō synthesizes an **actionable execution plan**:
- Breakdowns into 15-to-90 minute deep-work blocks.
- Explicit hard deadlines (e.g. *"Complete pitch deck slides 1–5 by 5:00 PM today"*).
- Clear countermeasure protocols for anticipated friction.

### 3. Strict 4-Phase Bounded Interaction Protocol
Every Mazō session follows a deterministic, 4-phase protocol:
```
[Phase 1: Triage] ──▶ [Phase 2: Challenge] ──▶ [Phase 3: Plan Formulation] ──▶ [Phase 4: Exit & Lock]
  (Identify Core         (Strip Excuses &       (Synthesize Concrete Milestone,   (Deliver Clear Next Step,
    Bottleneck)             Overthinking)          Deadlines & Protocols)           End Session)
```

### 4. Enforced Disengagement
When the plan is formulated and the commitment is made, **Mazō deliberately ends the conversation.** 
Its parting instruction is always the same: *"Put the phone down and execute."* Mazō explicitly refuses to keep chatting once a plan is locked.

---

## 🔍 Implementation Scope & Simulation Boundary

To maintain clear and honest boundaries, here is what this standalone CLI runner implements versus what belongs to external hosts:

### Implemented in this CLI Runner:
- **Goal Compilation**: Generates structured CALL-E goals based on coach archetypes, client identity, and session modes (`kickoff` vs. `followup`).
- **Safe Dry-Run Simulation**: Default zero-side-effect simulation with pre-baked demonstration fixtures.
- **Planning-Only CLI Path & Outbound REST Fallback**: The successful CLI path (`calle call plan`) is planning-only; `calle call plan` creates and validates the call task schema but does not place the advertised outbound call. Live outbound phone dialing requires provider execution or direct CALL-E REST API dispatch (`POST /v1/calls`) with an authorized API key.
- **Strict Destination Authorization**: Requires an explicit authorized E.164 destination in live mode and enforces non-empty `ALLOWED_RECIPIENTS`.
- **Pre-Call Operator Gate**: Interactive confirmation prompt (`y/N`) before initiating any live call plan.
- **Privacy & PII Masking**: Automatically masks phone numbers, client usernames, session topics, goal prompts, structured plan secrets (including quoted JSON `confirmation_token` keys), REST error bodies, and subprocess outputs.

### Host-Scheduler & Platform Boundaries (Not Implemented in this CLI):
- **Automated Recurring Scheduling**: This script is a one-shot dispatcher. Automated recurring routines (e.g., morning 8:30 AM kickoffs or evening verifications) must be managed by an external host scheduler (such as cron, an n8n workflow, or an agent platform).
- **Live Transcript Extraction & Reconciliation**: Post-call JSON data displayed in the CLI output is a static demonstration fixture. Real-time post-call transcription parsing, automated calendar synchronization, and streak updates require an external webhook or post-call processing pipeline.
- **Deduplication & Cooldown Enforcement**: Persistent state tracking, rate limiting, and cooldown intervals across calls are host-level responsibilities and are not tracked inside this script.

---

## 🎯 Specialized Coaching Archetypes

Mazō features purpose-built coaching personalities tailored to different cognitive barriers:

| Coach Archetype | Focus Area | Core Philosophy |
| :--- | :--- | :--- |
| **The Clarifier** | Overthinking & Ambiguity | *"What is the single highest-leverage thing you need to figure out right now?"* Cuts through noise to identify the core root problem. |
| **The Executioner** | Resistance & Procrastination | *"Done is better than perfect."* Focuses on momentum, micro-actions, and immediate 15-minute execution blocks. |
| **The Stoic** | Stress, Chaos & Overwhelm | *"Control what is yours; release what is not."* Centers emotions, eliminates manufactured urgency, and instills quiet clarity. |
| **The Deep Work Architect**| Focus & Time Blocking | Eliminates shallow distraction, optimizes cognitive energy, and safeguards calendar focus sessions. |

---

## 🛡️ Safety Model & Operational Guardrails

Telephony agents interact with the physical world and require rigorous safeguards:

1. **Dry-Run by Default**:
   Running without `--live` simulates the call lifecycle, goal compilation, and demonstration output with **0 live telephone calls** and **0 charges**. Synthetic numbers (`+15555550199`) are permitted exclusively in dry-run mode.
2. **Explicit Authorized Destination for Live Calls**:
   In `--live` mode, an explicit `--phone <E.164>` destination must be supplied on the command line. Falling back to synthetic or default numbers is blocked.
3. **Mandatory Recipient Whitelisting (`ALLOWED_RECIPIENTS`)**:
   In `--live` mode, the `ALLOWED_RECIPIENTS` environment variable must be explicitly configured with comma-separated authorized numbers. An empty or missing allowlist refuses live calls immediately.
4. **Strict E.164 Phone Sanitization**:
   All phone inputs are validated against `^\+[1-9]\d{6,14}$`. Malformed numbers fail closed immediately.
5. **Comprehensive PII & Sensitive Output Masking**:
   Phone numbers are masked across all console logs, validation errors, CLI plan outputs, REST error payloads, and subprocess messages (`+15****99`). Client usernames (`O***r`), session topics (`Fina***ine`), goal prompts (`[REDACTED_GOAL_PROMPT]`), Bearer tokens, and structured plan secrets (including quoted JSON `confirmation_token` keys) are automatically redacted.
6. **Explicit Human Confirmation Gate**:
   Live calls require interactive user confirmation (`y/N`) before dialing out, preventing inadvertent dispatches.
7. **Submitted-Call Cancellation Limits**:
   Once an outbound call request has been dispatched to CALL-E, it is queued and processed asynchronously by the telephony carrier. **In-flight submitted calls cannot be recalled or canceled from this client script.** Terminating the terminal process does not cancel an active carrier call. The interactive confirmation prompt (`y/N`) serves as the pre-dispatch safety gate.
8. **Bounded Non-Clinical Coaching & High-Stakes Exclusions**:
   - **Non-Clinical Boundary**: Mazō is strictly an executive productivity and time-management coach. It provides non-clinical cognitive accountability for procrastination and decision paralysis. It is **not a medical provider, mental health counselor, or crisis service**, and must never be used for psychological therapy.
   - **High-Stakes Exclusions**: Mazō explicitly excludes and refuses autonomous decision-making in medical, legal, financial, crisis, emergency, or employment-termination domains. If distress or emergency intent is detected, the agent disengages immediately and directs the user to professional resources.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- CALL-E CLI or Account API Key ([HeyCall-E](https://heycall-e.com))

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/CALLE-AI/awesome-phone-call-agents.git
cd awesome-phone-call-agents/apps/typescript/mazo

# Install dependencies
npm install
```

### 2. Run Safe Dry-Run Simulation (Default)
```bash
node mazo-coach.js \
  --user "Omar" \
  --coach "The Clarifier" \
  --topic "Finalizing Product Launch Timeline"
```

Output:
```text
======================================================
       MAZŌ — AI Executive Accountability Coach        
            Powered by CALL-E Phone Engine            
======================================================

👤 Client:   O***r
🎯 Coach:    The Clarifier
📞 Recipient: +15****99
💡 Topic:    Fina***ine
🔄 Call Type: Momentum Kickoff Call
⚡ Mode:     🟢 DRY-RUN (Safe Simulation)

--- [DRY-RUN SIMULATION] ---
• Validating coach persona and prompt constraints: PASS
• Generated CALL-E Goal: "You are The Clarifier, an... [REDACTED_GOAL_PROMPT]"
• Simulating call plan generation with CALL-E engine...
• Simulated Call Plan ID: plan_mazo_kickoff_72819
• Simulated Call Status: COMPLETED (Duration: 2m 15s)

--- [STRUCTURED OUTPUT EXTRACTED (SIMULATION FIXTURE)] ---
{
  "simulationNotice": "Static one-shot demonstration fixture. Live audio transcription, automated calendar extraction, recurring scheduling, cooldowns, and deduplication are host responsibilities and not implemented in this standalone CLI runner.",
  "sessionId": "sess_kickoff_1092",
  "callType": "kickoff_and_lockin",
  "coach": "The Clarifier",
  "client": "Omar",
  "status": "simulated_completed",
  "outcome": "Milestone prioritization simulated output",
  "actionItems": [
    {
      "task": "Finalize core API contract and submit production build",
      "deadline": "Today @ 5:00 PM",
      "priority": "high",
      "identifiedObstacle": "Context-switching between design and architecture",
      "solution": "90-minute deep work block with notifications silenced"
    }
  ],
  "breakthroughMoment": "Realized that shipping the core feature first unblocks the entire product release."
}

✅ Dry-run completed successfully with 0 telephone side-effects.
💡 Tip: Try the verification loop with: node mazo-coach.js --mode followup
💡 To place a real live call with CALL-E, run with: --live --phone "+<your_authorized_number>"
```

### 3. Run Live Call
```bash
# Set your allowed destination numbers
export ALLOWED_RECIPIENTS="+1234567890"

# Execute live call (requires explicit authorized --phone)
node mazo-coach.js \
  --phone "+1234567890" \
  --user "Omar" \
  --coach "The Clarifier" \
  --live
```

---

## 🛠️ CLI Options

| Flag | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `--phone` | String | Target recipient phone number in strict E.164 format (Required for `--live`) | `+15555550199` (dry-run only) |
| `--user` | String | Client name for personalized coaching context | `Omar` |
| `--coach` | String | Coach persona (*The Clarifier, The Stoic, The Executioner*) | `The Clarifier` |
| `--mode` | String | Session mode (`kickoff` or `followup`) | `kickoff` |
| `--topic` | String | Focus subject or pending roadblock | `Weekly Momentum...` |
| `--live` | Flag | Place real live phone call via CALL-E (Requires explicit `--phone` & `ALLOWED_RECIPIENTS`) | `false` (Dry-run) |
| `--yes`, `-y`| Flag | Skip interactive confirmation in automated test environments | `false` |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
