# Production reference

**Vector Research Labs — "Readiness Escalation Line"** is a production implementation
of this pattern. When a physiological-readiness engine flags an athlete RED, an
autonomous assistant (Juliet) phones a role-based responder chain (trainer →
physician) until someone acknowledges, then escalates to the owner if no one does —
every attempt logged with its structured acknowledgment.

- Alert shape: `{ athlete, metric, level, driver, recommendation }`
- Contact chain: ordered `escalation_contacts` (role, phone, chain_order), allowlist-gated
- Guardrails: allowlist-only, AI disclosure, non-diagnostic language, human-in-the-loop
- Lifecycle: `plan_call → run_call → get_call_run` via the `calle` CLI (browser-login auth)

The mapping from CALL-E's outcome envelope to an acknowledgment boolean
(`acknowledged = task_completed && confidence high`, terminal-negative → not
acknowledged) is implemented in [`../scripts/run_escalation.ts`](../scripts/run_escalation.ts)
and covered by [`../scripts/run_escalation.test.ts`](../scripts/run_escalation.test.ts).

Source: https://github.com/CALLE-AI/awesome-phone-call-agents (this repo) ·
reference build: Juliet (Strands Agents + Bedrock AgentCore).
