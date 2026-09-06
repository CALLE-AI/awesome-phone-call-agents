# Mazō — Autonomous AI Executive Coach

> **Turn overthinking into decisive action.** Mazō is a proactive executive coaching agent that initiates real-time phone calls via **CALL-E** to conduct high-leverage accountability sessions, unblock strategic decisions, and automatically convert spoken commitments into structured tasks.

[![Platform: CALL-E](https://img.shields.io/badge/Platform-CALL--E-000000.svg)](https://heycall-e.com)
[![Runtime: Node / TypeScript](https://img.shields.io/badge/Runtime-TypeScript%20%7C%20Node.js-3178C6.svg)](https://www.typescriptlang.org/)
[![Safety: Consent-First](https://img.shields.io/badge/Safety-Dry--Run%20%26%20Consent%20First-10B981.svg)](#safety-model)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌟 Executive Summary

Most productivity tools and AI chatbots fail for one fundamental reason: **they are passive.** 

When a user closes their chat window or laptop, intentions dissolve into procrastination. Text-based AI coaches wait for you to open the app; if you are stuck, overwhelmed, or avoiding a difficult task, you simply don’t open it.

**Mazō redefines AI coaching by picking up the phone.**

Powered by **CALL-E's autonomous telephony engine**, Mazō proactively calls founders, executives, and high performers at scheduled intervals or critical moments. Over a structured 3-to-5 minute phone conversation, Mazō:
1. Pinpoints current bottlenecks and decision paralysis.
2. Applies battle-tested executive coaching frameworks.
3. Secures a crystal-clear commitment.
4. Parses the call audio into structured, actionable items written straight to the user's execution system.

---

## 🏗️ Architecture & Workflow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MAZŌ COACHING PIPELINE                           │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
   1. TRIGGER                         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ • Scheduled Momentum Check-in (Cron / Schedulers)                     │
  │ • Proactive Stalled-Task Detector (Background Monitor)                 │
  │ • User-Initiated "Quick Momentum" Call Button                          │
  └────────────────────────────────────────────────────────────────────────┘
                                      │
   2. PLANNING & PERSONA SELECTION   ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ • Select Coach Archetype (e.g. The Clarifier, The Stoic, Executioner)  │
  │ • Assemble Client Context (Pending Goals, Challenges, Habit Triggers)  │
  │ • Formulate CALL-E Call Goal & Structured Extraction Schema            │
  │   `calle.call.plan({ toPhone, goal, systemPrompt })`                   │
  └────────────────────────────────────────────────────────────────────────┘
                                      │
   3. REAL-TIME CALL EXECUTION        ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ • CALL-E Telephony Engine dials recipient via E.164 line               │
  │ • Adaptive Real-time Voice Interaction (Sub-second latency)            │
  │ • 4-Phase Protocol: Opening ➔ Deep Challenge ➔ Commit ➔ Exit          │
  └────────────────────────────────────────────────────────────────────────┘
                                      │
   4. STRUCTURED EXTRACTION           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ • Real-time Call Transcript & Audio Stream                             │
  │ • Extract: Action Item, Hard Deadline, Obstacle, Breakthrough Moment   │
  │ • Sync to Memory Graph, Task Engine & User Schedule                    │
  └────────────────────────────────────────────────────────────────────────┘
```

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

Telephony agents interact with the physical world and require rigorous safeguards. Mazō enforces strict safety protocols:

1. **Dry-Run by Default**:
   Running without `--live` simulates the complete call lifecycle, goal compilation, and structured output extraction with **0 live telephone calls** and **0 charges**.
2. **Explicit Human Confirmation**:
   In live mode, Mazō requires interactive confirmation (`y/N`) before dialing out unless explicitly configured in headless environments.
3. **Recipient Whitelisting (`ALLOWED_RECIPIENTS`)**:
   Calls can only be placed to numbers explicitly declared in the `ALLOWED_RECIPIENTS` environment variable or verified user profiles.
4. **Strict E.164 Phone Sanitization**:
   All inputs are validated against `^\+[1-9]\d{6,14}$`. Malformed numbers fail closed immediately.
5. **PII Masking**:
   Phone numbers are masked in all logs, console outputs, and analytics (`+12****99`).
6. **No Infinite Dial Loops**:
   Idempotency tokens and cooldown intervals prevent repeated calls if the user rejects or misses a call.

---

## 💻 How It Works with CALL-E

Mazō leverages the official CALL-E SDK / CLI contract:

### 1. Planning Phase (`calle call plan`)
```bash
calle call plan \
  --to-phone "+15555550199" \
  --goal "You are The Clarifier, calling Omar for a 3-minute executive momentum check-in. Identify his top bottleneck on Q3 execution, agree on the single next action, and record deadline."
```
Returns a `plan_id` and verification confirmation.

### 2. Execution Phase (`calle call run`)
```bash
calle call run --plan-id "<PLAN_ID>"
```
CALL-E initiates the real-time telephony bridge, streaming audio through the natural voice synthesis pipeline.

### 3. Extraction & Reconciliation (`calle call status`)
```bash
calle call status --run-id "<RUN_ID>"
```
Returns audio state, call completion status, and structured JSON results for automated task creation.

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
  --phone "+15555550199" \
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

👤 Client:   Omar
🎯 Coach:    The Clarifier
📞 Recipient: +15****99
💡 Topic:    Finalizing Product Launch Timeline
⚡ Mode:     🟢 DRY-RUN (Safe Simulation)

--- [DRY-RUN SIMULATION] ---
• Validating coach persona and prompt constraints: PASS
• Generated CALL-E Goal: "You are The Clarifier, an elite executive coach in Mazō calling Omar..."
• Simulating call plan generation with CALL-E engine...
• Simulated Call Plan ID: plan_mazo_demo_88291
• Simulated Call Status: COMPLETED (Duration: 2m 45s)

--- [STRUCTURED OUTPUT EXTRACTED] ---
{
  "sessionId": "sess_demo_1092",
  "coach": "The Clarifier",
  "client": "Omar",
  "status": "completed",
  "outcome": "Breakthrough achieved on product milestone prioritization",
  "actionItems": [
    {
      "task": "Finalize core API contract and submit production build",
      "deadline": "Today @ 5:00 PM",
      "priority": "high",
      "identifiedObstacle": "Context-switching between design and architecture",
      "solution": "90-minute deep work block with notifications silenced"
    }
  ],
  "breakthroughMoment": "Realized shipping the core feature first unblocks the entire release.",
  "nextScheduledCheckin": "Tomorrow @ 9:00 AM"
}

✅ Dry-run completed successfully with 0 telephone side-effects.
```

### 3. Run Live Call
```bash
# Set your allowed destination number
export ALLOWED_RECIPIENTS="+15555550199"

# Execute live call
node mazo-coach.js \
  --phone "+15555550199" \
  --user "Omar" \
  --coach "The Clarifier" \
  --live
```

---

## 📊 Post-Call Extraction Schema

Mazō enforces structured JSON extraction after every completed CALL-E session:

```typescript
export interface MazoCallSessionResult {
  sessionId: string;
  coachId: string;
  durationSeconds: number;
  outcomeSummary: string;
  breakthroughInsight?: string;
  actionItems: Array<{
    title: string;
    targetCompletion: string;
    priority: 'low' | 'medium' | 'high';
    obstacleIdentified?: string;
  }>;
  followupScheduledAt?: string;
}
```

---

## 🛠️ CLI Options

| Flag | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `--phone` | String | Target recipient phone number in strict E.164 format | `+15555550199` |
| `--user` | String | Client name for personalized coaching context | `Omar` |
| `--coach` | String | Coach persona (*The Clarifier, The Stoic, The Executioner*) | `The Clarifier` |
| `--topic` | String | Focus subject or pending roadblock | `Weekly Momentum` |
| `--live` | Flag | Place real live phone call via CALL-E | `false` (Dry-run) |
| `--yes`, `-y`| Flag | Skip interactive prompt in CI/automated environments | `false` |

---

## 🗺️ Roadmap

- [x] CALL-E Real-Time Telephony Pipeline Integration
- [x] Interactive Multi-Archetype Coaching Framework
- [x] Structured Action Item & Calendar Reconciliation
- [ ] Multi-party Accountability Calls (Team standups & Co-founder alignments)
- [ ] Real-time WebRTC browser fallbacks for low-cellular environments

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
