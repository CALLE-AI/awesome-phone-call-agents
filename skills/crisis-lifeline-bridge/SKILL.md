---
name: crisis-lifeline-bridge
description: When a person shows acute-crisis signals (housing loss, food insecurity, fraud victimization, domestic violence, deportation fear, medical emergency, self-harm, or severe isolation), find a REAL local human service for their situation and use CALL-E to phone-verify that service is real and in-service BEFORE referring the person to it. Verify-before-refer safety so an agent never hands a vulnerable person a fake, dead, or wrong number.
license: MIT
---

# Crisis Lifeline Bridge

Use this skill when an AI agent detects that a person it is talking to is in **acute crisis** and would be better served by a **real human service** than by more conversation. It turns "here's a number, good luck" into "I called them, they're real, they're open, here's who to ask for."

`crisis-lifeline-bridge` is a **verify-before-refer** wrapper. It does not diagnose, triage medical emergencies, or replace emergency services. It finds a candidate local agency for the person's specific need and location, then uses the existing CALL-E one-off call workflow to place **one verification call** to that agency to confirm the line is real, in service, and can actually help — before the agent gives the number to the person.

## The Problem It Solves
People in crisis get handed generic hotline numbers constantly. Most never call. And when an agent surfaces a number from a web search, that number is often **out of date, disconnected, wrong department, or a national line that can't help locally**. A dead or wrong number given to someone in crisis is worse than none — it burns the one moment they were ready to reach out. This skill closes that gap: **no resource is given to the person until a real call has confirmed it is real and reachable.**

## When To Use
- An agent has classified a person's messages as acute crisis (severity high) with a concrete need: emergency shelter, food, domestic-violence safety, immigration legal aid, mental-health/self-harm support, utility/eviction help, fraud/exploitation recovery.
- The agent already has (or can research) a candidate **local** agency + phone number for that need.
- The operator wants the referral **phone-verified** before it is handed to the person.

## When Not To Use
- **Imminent danger to life.** If someone is in immediate physical danger or actively attempting self-harm, do NOT run a verification workflow. Direct them to emergency services (e.g. 911 in the US) and the national crisis line (e.g. 988 in the US) immediately. This skill is for *routing to ongoing human services*, not for handling a live emergency.
- To place a call **to the person in crisis** without their explicit consent and their own number.
- To guess a phone number, country code, region, or language. Never infer these.
- To diagnose, counsel, or make medical/legal/financial decisions on the person's behalf.
- To create recurring calls or a monitoring daemon.

## Core Workflow
```text
detect crisis  ->  research local agency  ->  VERIFY by phone (CALL-E)  ->  refer only if verified
```
1. **Confirm severity + need.** The host agent classifies the person's situation (see `references/crisis-classification.md`): severity 1-5 and a marker type (housing / food / dv / deportation / medical / self_harm / fraud / isolation). This skill engages at severity >= 4 with a concrete, addressable need.
2. **Determine location + need.** Infer the person's region/city ONLY from what they or their public profile actually state. Never guess from locale, IP, or phone. If location is unknown, ask, or fall back to a verified national line for the stated country.
3. **Research a candidate agency.** Use `scripts/find-local-agency.mjs` (or the host's own research tool) to find a real local service for the need + place. Capture name, phone (E.164 when possible), hours, URL, source.
4. **Verify by phone with CALL-E.** Use `scripts/verify-agency-call.mjs`. It plans a call whose goal is to *confirm the line is real and in service, ask intake hours and current capacity* — the caller represents nobody, it is confirming service details; it runs the call **only** when a real `to_phone` is present (planning alone never calls); then fetches the structured result.
5. **Refer only if verified.** If the call confirms a real, reachable service, the agent gives the person that number with specifics ("ask for intake, they're open until 8pm, they had space today"). If verification fails (disconnected / wrong / no capacity), the agent does NOT hand out that number — it researches another, or falls back to the best verified national line, and is honest that it could not confirm a local option.

## Honesty Rail (non-negotiable)
The agent may only tell a person a resource is real if a call verified it **this run**, or it is a well-known standing national line for their country. **Never invent, embellish, or assume** a hotline, address, or capacity. An unverifiable local option becomes: "I couldn't confirm a local service right now, but this national line is real: <line>. I'm here while you call."

## Dry-Run Default (no real calls to try it)
Everything runs with **no real phone call** by default:
- `find-local-agency.mjs` ships with bundled sample agencies and only hits a live research endpoint when `RESEARCH_URL` (+ optional `RESEARCH_TOKEN`) are set.
- `verify-agency-call.mjs` runs in dry-run mode by default: it produces the exact `plan_call` goal and a simulated verified result **without invoking CALL-E**. Add `--live` (and a real, consented, non-sample E.164 number) to place an actual verification call.
- All sample numbers are fictional reserved samples (`+1 555 01xx`).

## CALL-E Integration
Host + provider: any Agent-Skills-compatible host (Claude Code, Codex, skills.sh, Cowork-style agents) with the CALL-E CLI/MCP available. See `references/calle-cli-bootstrap.md` for resolving the `calle` command and the `plan_call` -> `run_call` -> `get_call_run` flow, and `references/safety.md` for the full safety contract.

## Side Effects
This skill can cause a **real outbound phone call** to a service agency (only in `--live` mode with a real number). It never calls the person in crisis. It creates no recurring jobs and no schedules. There is nothing to cancel in dry-run; a live verification call is a single one-off call.
