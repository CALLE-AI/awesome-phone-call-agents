---
name: codex-call-reminder
description: Dry-run scaffold for phone-call reminders via CALL-E SDK. No live telephony in this PR.
version: 0.1.0
author: rafaio1
tags: [codex, skill, call, reminder, dry-run, scaffold]
---

# Codex Call Reminder

> ⚠️ **DRY-RUN SCAFFOLD ONLY** — This PR ships a *simulation/scaffold* for phone-call reminders. It does **not** place real calls, connect to any telephony provider, or transmit audio. Real CALL-E integration requires separate credentials, network access, and maintainer approval. All outputs are synthetic unless `--confirm` is passed with valid `CALLE_API_KEY`.

Portable phone-call reminder **scaffold** for Codex CLI agents. Demonstrates safe invocation patterns, E.164 validation, masking, and cancellation semantics via CALL-E SDK contract.

## When to use

- User asks an agent to remind someone by phone call
- Recurring or one-off appointment/confirmation/follow-up reminders
- Workflow needs a safe, auditable phone-call reminder *interface contract* (dry-run)

## Prerequisites

- CALL-E API key in environment (`CALLE_API_KEY`)
- Phone number in E.164 format
- Explicit user consent before placing any real call
- Understanding that this skill is a *scaffold*: no live calls without external integration

## Usage

```bash
# Dry run (no real call placed)
python3 scripts/remind.py --to +15550001234 --message "Appointment tomorrow at 3pm" --dry-run

# Simulated real call (still dry-run unless CALLE_API_KEY set and backend connected)
python3 scripts/remind.py --to +15550001234 --message "Appointment tomorrow at 3pm" --confirm
```

## Safety

- Always default to `--dry-run` unless `--confirm` is explicitly passed
- Strict E.164 validation enforced before any processing
- Never store phone numbers in logs; mask to last 4 digits
- Cancellation: `python3 scripts/remind.py --cancel <call-id>`
- No medical, legal, financial, or emergency content without human review
- This scaffold does NOT initiate real calls; output is synthetic for interface validation

## Side effects

When integrated with live CALL-E backend: places outbound call on `--confirm`, schedules recurring jobs. In this scaffold: emits structured JSON only. Both modes support cancellation ID generation.

## Host compatibility

Tested with Codex CLI. Compatible with any Agent Skills host that supports Python subprocess execution.

## Validation Gate

All phone numbers MUST pass strict E.164 regex (`^\+[1-9]\d{1,14}$`) before processing. Invalid numbers are rejected with error code `INVALID_E164`.
