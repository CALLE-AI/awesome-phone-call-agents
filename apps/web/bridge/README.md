# BRIDGE — AI Business Coordination Layer

BRIDGE is an AI business coordination layer that uses CALL-E to resolve multi-person business workflows through targeted phone conversations.

## Problem

Many operational tasks are blocked not because software is missing, but because the right people are not connected at the right moment with the right context and decision authority.

## Core Workflow

```text
Business Problem
  --> Identify Right Person
  --> CALL-E Conversation
  --> Structured Result
  --> Select Next Person
  --> Continue until Resolution
```

### Example: Delivery Exception Resolution

```text
Driver --> Warehouse Manager --> Operations Head --> Customer --> Resolved
```

1. **Driver (Arjun)**: Reports breakdown on NH-48; confirms vehicle is disabled and recovery takes 90+ minutes.
2. **Warehouse Manager (Amit)**: Checks inventory; confirms replacement Van #9 can depart by 16:30 with an emergency priority fee.
3. **Operations Head (Priya)**: Evaluates budget limit; approves emergency replacement dispatch cost.
4. **Customer (Rahul)**: Accepts revised delivery window of 17:00 today.
5. **Resolved**: Automated ticket closure, status notification, and dispatch log recorded.

## Features

- **Organization-Aware Person Selection**: Models authority limits, responsibilities, on-call roles, and escalation links.
- **Multi-Step Workflow Orchestration**: Autonomous state machine that cycles through human checkpoints until task resolution.
- **CALL-E Integration**: End-to-end plan, confirm, run, status lifecycle with structured results and audio waveform visualization.
- **Simulation / Dry-Run Mode**: Full testability without consuming CALL-E voice credits.
- **Structured Call Results**: Extracts key variables (status, replacement vehicle, authorized spend, confirmed ETA).
- **Automatic Next-Person Selection**: Dynamic scoring algorithm ranks candidates based on current task need and past attempts.
- **Human Escalation**: Enforces budget ceilings and escalation paths to management when limits are exceeded.
- **Task Timeline & Logs**: Deep history audit trail showing each attempt, audio waveform, and dialogue transcript.
- **Interactive Org Graph**: Visual network graph of team members and active call nodes.
- **Workflow Builder**: Visual editor with pre-loaded templates for logistics, cold-chain, and VIP customer escalations.

## Safety & Security

- **Simulation Mode Default**: Runs by default in simulation mode for safe zero-cost evaluation.
- **Explicit Live Confirmation**: Live CALL-E calls require explicit user confirmation via modal prompt before dialing.
- **No Credentials Committed**: Uses environment variables from `.env.example` for secrets.
- **Masked Fictional Numbers**: All sample contact numbers use standard masked numbers (e.g., `+91******0878`).

## Quick Start

### Installation

```bash
npm install
```

### Environment Setup

Create a local `.env` from `.env.example`:

```bash
cp .env.example .env
```

Configuration variables:

- `PORT=3000`
- `BRIDGE_MODE=simulation` (or `live`)
- `CALLE_SERVER_URL` (optional custom CALL-E server)

### Running Locally

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Testing

Run the automated test suite:

```bash
npm test
```

Validates organization queries, scenario initialization, orchestrator scoring, the full 4-stage delivery exception sequence, and simulation fallback behavior.

## Project Structure

```text
apps/web/bridge/
├── data/
│   ├── organization.json
│   └── workflows.json
├── public/
│   └── index.html
├── src/
│   ├── bridge.js
│   ├── calle.js
│   ├── orchestrator.js
│   ├── organization.js
│   ├── simulation.js
│   ├── server.js
│   └── scenarios/
│       └── delivery.js
├── test/
│   └── bridge.test.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```
