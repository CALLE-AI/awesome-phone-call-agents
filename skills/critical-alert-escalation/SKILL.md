---
name: critical-alert-escalation
description: Escalate a critical alert by phone until a human acknowledges. Given an alert, an ordered on-call contact chain, and an acknowledgment schema, it places calls through CALL-E (plan_call → run_call → get_call_run), captures a structured verbal acknowledgment, and escalates to the next responder if the alert isn't confirmed — logging every attempt. Use for on-call, incident, safety, or readiness alerts where a screen notification can be missed and confirmed receipt matters.
---

# Critical Alert Escalation

A dashboard notification is worthless if the responsible human isn't looking at a screen. This skill closes the loop over the phone: when a critical alert fires, it **calls** a human, delivers the alert in plain language, captures a **structured acknowledgment**, and — if no one confirms — **escalates up an on-call chain** until someone does, logging every attempt with a timestamp.

It is the phone equivalent of an on-call escalation policy (PagerDuty-style), built on CALL-E's outbound calling and structured results.

Operating principle: **fail toward escalation.** Anything short of a clear, confident acknowledgment (declined, no answer, ambiguous, low confidence) is treated as *not acknowledged*, and the skill moves to the next responder. A missed alert is worse than an extra call.

## When to use

- On-call / incident escalation (ops, IT, security) where an ack must be confirmed by voice.
- Safety or readiness alerts (e.g. a physiological-readiness flag for an athlete or operator) that a responsible human must receive and act on.
- Any "someone has to confirm they've got this, now" situation where email/Slack can be missed.

Not for: marketing, cold outreach, or any call to a number that hasn't opted into the escalation chain.

## The call lifecycle (per responder)

Runs CALL-E's standard sequence for each contact, in chain order, until acknowledged:

1. **Auth** — `calle auth status` (browser-login token held by the CALL-E CLI).
2. **plan_call** — prepare one outbound call to the next responder; the goal delivers the alert + recommendation and asks for confirmation.
3. **run_call** — dial.
4. **get_call_run** — poll (or receive the terminal webhook) for the structured result.
5. **Evaluate** — acknowledged with confidence → stop; otherwise log the attempt and continue to the next responder. If the chain is exhausted, escalate to the owner/on-call manager (out-of-band notification).

## Inputs

- **alert**: `{ title, detail, recommendation }` — what happened and the recommended action, in non-jargon language.
- **contact_chain**: ordered `[{ role, phone_e164, order }]` — the responders, most-responsible first. All numbers must be on the allowlist.
- **acknowledgment schema** (the CALL-E result target):

```json
{
  "reached": "boolean — a live human answered",
  "acknowledged": "boolean — they confirmed receipt of the alert",
  "responder_role": "string — who acknowledged",
  "action_taken": "string — what they said they'd do",
  "notes": "string"
}
```

- **disclosure**: the AI-identification line prepended to every call goal.

> CALL-E returns its own outcome envelope (`{ task_completed, confidence, evidence }` + a `summary`). **Authoritative ack only:** `acknowledged = task_completed === true AND confidence ≥ threshold AND evidence present`. A bare `acknowledged: true` in the payload is **not** sufficient and is ignored. Keep `summary` as `notes`. Anything else — low confidence, missing evidence, `task_completed !== true`, a terminal-negative status — is *not acknowledged* (fail toward escalation).

## Guardrails & safety (non-negotiable)

Phone calls have real-world side effects. This skill enforces:

- **Allowlist only.** Calls are placed only to numbers explicitly registered in the escalation chain. Never dial an unknown or unconsented number.
- **AI disclosure on every call.** The goal opens with an identification line, e.g. `"This is an automated readiness assistant calling on behalf of <org>."`
- **Consent.** Responders opt into the on-call chain in advance; this skill is for people who expect these calls, not the public.
- **Human decides.** The call delivers a classification + recommendation and requests acknowledgment. It never makes the operational or medical decision. For health/readiness use, language stays non-diagnostic (state the flag and recommendation; do not diagnose).
- **Fail toward escalation** (see operating principle) — a *resolvable* negative (declined/no-answer/voicemail/low-confidence) advances the chain, never silently closes the alert.
- **Nothing hidden.** Every attempt (reached/declined/acknowledged) is logged with responder, timestamp, and structured result. Escalations are visible to the alert owner.

These are enforced in `scripts/run_escalation.ts` (not just documented) and covered by no-call unit tests in `scripts/run_escalation.test.ts`:

- **E.164 only.** A number that doesn't match `^\+[1-9]\d{1,14}$` is rejected before dialing.
- **Dry-run by default.** A live call requires **both** the env opt-in `CALLE_LIVE=1` **and** an explicit `confirmLiveCall` on the run. Without both, the skill previews the chain and places no call — it is impossible to dial live without both.
- **Stable idempotency.** A deterministic key per `(alertId, contact, attempt)` is passed to `plan_call`/`run_call`, so a retry with the same inputs can't double-dial.
- **Ambiguous-leg reconciliation.** A leg with no terminal outcome is re-polled (`get_call_run`) to a terminal state; if it still can't be resolved, the skill **stops and flags for review** rather than advancing on a guess.
- **Between-legs status check.** Before each leg, the skill checks the alert isn't already acknowledged/resolved out-of-band; if it is, it halts.

## Setup

1. Install and authenticate CALL-E (CLI + browser login) per the CALL-E integration guide; confirm `calle mcp tools` lists `plan_call`, `run_call`, `get_call_run`.
2. Define the **allowlist** and the **contact_chain** (roles, E.164 numbers, order).
3. Provide the alert source (your monitor/flag system) that invokes the skill with an `alert` payload.

## Side effects, cancellation, results

- **Side effects:** places real outbound phone calls (billable; reaches real people). Use test numbers while developing.
- **Cancellation:** an in-progress escalation is stopped by marking the alert acknowledged/closed in the owning system before the next leg dials; the skill checks alert status between legs.
- **Result handling:** each leg writes a structured record (reached, acknowledged, responder, action_taken, run id, status). On acknowledgment the alert closes; on chain exhaustion the owner is notified out-of-band.

## Example (masked numbers)

Readiness-flag escalation, two-leg chain:

```
alert: { title: "Athlete flagged RED", detail: "HRV 33, load +54%, 3-day strain",
         recommendation: "hold from recovery" }
chain: [ { role: "trainer",   phone_e164: "+15550101234", order: 1 },
         { role: "physician", phone_e164: "+15550105678", order: 2 } ]

Leg 1 → trainer (+15550101234): no answer / declined  → not acknowledged → escalate
Leg 2 → physician (+15550105678): "Got it, I'll hold him for recovery."
        → acknowledged=true, action_taken="hold from recovery" → alert closed, logged.
```

## Field notes for integrators

- CALL-E dials from **rotating caller IDs**; recipients using call-screening may auto-decline. Responders should expect the call (or whitelist on their device) — allowlisting your own number in the skill does not affect their screening.
- Prefer the **terminal webhook** over long polling; a call can sit in `PREPARING` for a while before it connects.

## Reference implementation

`scripts/run_escalation.ts` orchestrates the chain over the CALL-E CLI (`plan_call` → `run_call` → `get_call_run`) with the guardrails above — a single guarded entry point; the raw MCP tools are never exposed to the calling model. `scripts/run_escalation.test.ts` covers the acknowledgment evaluation. See `references/` for the acknowledgment schema and a production reference (Vector Research Labs' "Readiness Escalation Line" built on this pattern). Adapt the alert source and contact chain to your system.
