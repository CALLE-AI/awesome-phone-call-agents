# Mazō — Autonomous AI Executive Coach
*CALL-E Hackathon ("Your Code Is Calling") Devpost Submission Packet*

---

## 📌 Project Overview

- **Project Name:** Mazō — Autonomous AI Executive Coach
- **Elevator Pitch (140 chars):** Autonomous executive coaching agent powered by CALL-E that proactively calls your phone, breaks through overthinking, and locks in execution.
- **Track / Category:** Productivity, AI Agent Workflows, Telephony & Voice AI
- **Repository / Pull Request:** [CALLE-AI/awesome-phone-call-agents Pull Request](https://github.com/CALLE-AI/awesome-phone-call-agents)

---

## 💡 Inspiration: The Fatal Flaw of Productivity Tech

Most productivity apps, habit trackers, and AI chatbots fail for one simple psychological reason: **they are passive.**

When an entrepreneur or high-performer is stuck in decision paralysis, procrastinating, or overwhelmed:
- They don't open Notion.
- They don't open their to-do list.
- They certainly don't open a chatbot to type long paragraphs.

Intentions dissolve into avoidance.

**Mazō flips the equation: When you need momentum, Mazō calls you.**

By marrying **CALL-E's autonomous voice telephony** with structured cognitive coaching frameworks and **OpenAI GPT-4o**, Mazō acts as a ruthless chief of staff in your pocket. It doesn't wait for your motivation; it rings your phone, breaks your excuses down in a bounded 3-minute spoken conversation, secures a hard commitment, and extracts the action items directly into your execution system.

---

## 🛑 Rejecting "Infinite Chat Syndrome": An Extraction & Planning Engine

Most conversational AI assistants suffer from infinite conversation syndrome—users talk for hours about their goals, mistaking conversation for progress.

**Mazō explicitly rejects open-ended chatting.** It is engineered as a bounded 4-phase finite state machine:
```
[Phase 1: Triage] ──▶ [Phase 2: Challenge] ──▶ [Phase 3: Plan Formulation] ──▶ [Phase 4: Exit & Lock]
  (Identify Core         (Strip Excuses &       (Synthesize Concrete Milestone,   (Extract JSON, Schedule
    Bottleneck)             Overthinking)          Deadlines & Protocols)           Follow-up, End Session)
```

The moment a plan is synthesized and an explicit commitment is made, **Mazō ends the call.** Its parting words are always: *"Put down the phone and go execute."*

---

## ⚡ What It Does

1. **Proactive Outbound Calls via CALL-E**:
   - **Morning Kickoff (8:00 AM)**: Greet the user, summarize the top pending priorities, and lock in the first action before morning distractions hit.
   - **Midday / Task Accountability**: Check in specifically on high-priority stalled tasks.
   - **Evening Reflection (8:00 PM)**: Review accomplishments, celebrate shipped milestones, and recalibrate tomorrow's plan.
   - **Instant Check-in**: 1-tap momentum call when facing immediate paralysis.

2. **Specialized Executive Coaching Archetypes**:
   - **The Clarifier**: Cuts through ambiguity and overthinking (*"What is the single highest-leverage bottleneck right now?"*).
   - **The Executioner**: Crushes resistance and perfectionism (*"What can we ship in the next 15 minutes?"*).
   - **The Stoic**: De-escalates cognitive overwhelm (*"Focus strictly on what is within your control"*).
   - **The Deep Work Architect**: Defends cognitive energy and builds protected 90-minute focus blocks.

3. **Verbal-to-Action Automatic Extraction**:
   - Call transcripts are parsed in real time into structured JSON containing:
     - Core breakthrough or cognitive shift.
     - Concrete commitments with hard deadlines.
     - Identified obstacles and countermeasure protocols.
   - Automatically synchronizes with the user's active task queue and calendar blocks.

4. **Closed-Loop Follow-Up Verification**:
   - Mazō rings back at the agreed deadline to verify completion evidence.
   - Shipped milestones award momentum score (+25 XP) and maintain daily streaks.

---

## 🛡️ Safety & Responsible AI Architecture

Telephony carries real-world side effects. Mazō implements a comprehensive defense-in-depth safety model:

1. **Dry-Run by Default**:
   Running `node mazo-coach.js` runs a complete, simulated execution pipeline with **0 live telephone calls and 0 carrier charges**.
2. **Explicit Human Confirmation**:
   In live mode (`--live`), Mazō requires interactive user confirmation (`y/N`) before dialing out.
3. **Strict E.164 Validation**:
   All phone inputs are validated against `^\+[1-9]\d{6,14}$`. Malformed numbers fail closed immediately.
4. **Recipient Whitelisting (`ALLOWED_RECIPIENTS`)**:
   Enforces authorized recipient lists to prevent accidental or unauthorized dials.
5. **PII Masking**:
   Recipient phone numbers are masked across all console logs, transcripts, and telemetry (`+15****99`).
6. **No Infinite Dial Loops**:
   Idempotency tokens and cooldown intervals prevent repeated calls on missed or rejected calls.

---

## 🏗️ How We Built It

- **Telephony Pipeline:** CALL-E autonomous voice engine (`calle` CLI and REST API) with sub-second latency voice bridges.
- **Agent Intelligence:** OpenAI GPT-4o / GPT-4o-mini structured reasoning with Zod schemas.
- **CLI Runner:** Zero-dependency Node.js runtime supporting cross-platform execution on macOS, Linux, and Windows.
- **Companion Mobile/Web App:** React Native, Expo SDK 54, TypeScript, TanStack Query, and AsyncStorage.
- **Testing & Verification:** Comprehensive automated test suite (`npm test`) validating phone validation, masking, prompt generation, and JSON schemas with 100% pass rate.

---

## 🧪 Testing Instructions

### 1. Zero-Setup Dry Run (Safe, No Credentials, No Charges)
```bash
cd apps/typescript/mazo
npm test           # Run 12 automated unit tests
npm start          # Run simulated momentum kickoff
```

### 2. Test Closed-Loop Follow-Up Mode
```bash
node mazo-coach.js --mode followup --coach "The Clarifier"
```

### 3. Live Phone Call (Requires CALL-E Account)
```bash
export ALLOWED_RECIPIENTS="+15555550199"
export CALLE_API_KEY="your-calle-api-key"

node mazo-coach.js --live --phone "+15555550199" --user "Omar"
```
