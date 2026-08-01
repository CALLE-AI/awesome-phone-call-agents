# DrillSignal

**Tagline:** Consented phone drills that prove on-call readiness before the real outage.

## The problem

Operations teams assume paging and on-call rotations work until a production incident proves otherwise. Email and chat checks do not validate that a human can answer a phone, acknowledge a scenario, and take ownership under pressure. Ad-hoc test calls lack consent boundaries, structured scoring, escalation rules, and audit evidence.

## The solution

DrillSignal is a runnable demo app for AI-agent phone-call workflows. It schedules a scoped business-continuity drill: call the primary on-call role, evaluate a strict structured result from CALL-E, and deterministically escalate to an approved backup when rules permit. The app produces an evidence-backed readiness report with masked audit data.

Default mode is **simulation** (no network). Judges and contributors can verify the full flow without credentials.

## Key features

- **Explicit consent and safety preview** before any side effect
- **Deterministic escalation** when primary is unavailable and backup is consented
- **Mission control** with launch confirmation, live status, and cancel controls
- **Structured CALL-E result schema** with scoring and malformed-result handling
- **Masked evidence excerpts** in after-action reports; full E.164 redacted after completion
- **Three modes:** simulation (default), fake-server (loopback SDK contract), live (opt-in)
- **Operator bearer token** when the server binds beyond loopback (Docker/hosted)

## CALL-E usage

DrillSignal uses the `@call-e/calle` SDK (v0.2.2) for fake-server and live modes. Simulation exercises orchestration without the SDK. Fake-server mode runs against an embedded or external loopback fake that implements the CALL-E contract. Live mode places one or two outbound calls per drill, bounded by the configured max call cap.

**Live verification is pending** until a real cloud call is performed with authorized numbers and documented in the evidence manifest. Repository tests and default demos do not place live calls.

## Technical implementation

- TypeScript / Node.js 20+ HTTP API and static web UI
- JSON file store with atomic launch claims and active-drill retention policy
- State machine and orchestrator with idempotency keys and single-flight launch
- Multi-stage Docker image: `npm ci` build, production runtime only, non-root user, `/data` volume, port 3847
- 54 source tests plus 2 post-build production static-serving tests covering security, cancellation, scoring, SDK contract, and end-to-end simulation

Built during the Jul 23-Sep 14, 2026 hackathon window as a reference app in Awesome Phone Call Agents.

## Safety

- No emergency, medical, legal, or financial use cases
- No hidden schedules or recurring jobs
- Duplicate launches blocked via durable claims and idempotency
- Operator token required for mutating APIs on non-loopback binds
- API keys never stored in drill records or client bundles
- Cancellation is honest about provider limits once a call is accepted

## Real-world impact

Teams can run repeatable, consented drills that mirror real escalation paths and produce comparable readiness scores. The workflow is portable for AI agents packaging phone-call side effects with explicit intent and audit trails.

## Challenges and lessons

- Separating simulation, fake-server, and live paths while sharing one orchestrator
- Enforcing safety preview and launch gates without letting launch arm a drill
- Redacting phone numbers in reports while retaining enough masked evidence for auditors
- Packaging TypeScript for Docker without dev dependencies in the final image

## Future work

- Additional drill scenarios beyond `production_outage`
- External store for multi-instance deployments
- Webhook or MCP integration for agent-driven drill scheduling
- Hosted demo environment (optional; not required for local verification)
