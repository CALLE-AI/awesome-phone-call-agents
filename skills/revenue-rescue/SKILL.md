---
name: "revenue-rescue"
title: "Revenue Rescue"
description: "Agent skill for packaging revenue recovery phone-call workflows with strict safety boundaries, structured result schemas, and dry-run-by-default execution."
tags: ["revenue", "finance", "safety", "governed", "automation", "payments"]
---

# Revenue Rescue Skill

## Overview
**Revenue Rescue** is an agent skill for packaging revenue recovery phone-call workflows. It detects high-value operational exceptions (e.g., failed payments), evaluates them through a decision engine, and executes multi-step CALL-E phone interactions with strict safety boundaries and structured result extraction.

**This skill requires:**
- An agent host (Claude Code, Cursor, MCP client) to invoke it
- A scheduler (external to this skill) for recurring workflows
- **Explicit human approval before any live CALL-E execution**

## When to Use This Skill
Use this skill when an AI agent needs to:
- Recover revenue from failed payments or expired cards
- Follow up on high-value operational exceptions
- Execute a phone call that requires strict adherence to safety and structured data extraction

## Prerequisites & Setup
1. **CALL-E CLI**: Must be installed and authenticated (`npm install -g @call-e/cli` + `calle auth login`)
2. **Environment**: Set `CALL_E_DRY_RUN=true` in your `.env` file (default) to test without placing live calls
3. **Dependencies**: Ensure the host environment has access to the `@call-e/cli`

## Input Payload Schema
The skill expects a structured trigger payload (e.g., from a webhook). Example:
```json
{
  "customer_id": "cus_demo_123456",
  "customer_phone": "+1-555-0100",
  "trigger_id": "evt_stripe_failed_987",
  "amount": 249.00,
  "failure_reason": "expired_card",
  "is_disputed": false,
  "timestamp": "2026-09-09T14:30:00Z"
}