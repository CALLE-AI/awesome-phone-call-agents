# AgentCover CALL-E Call Gate

A bounded-autonomy gateway that wraps every CALL-E phone call in the
[`safety_protocol`](https://github.com/TheDub-lab/safety-protocol) enforcement
layer. The agent never dials directly — every `run_call` intent is translated
into an `ActionRequest`, passed through binding → kill switch → scope → budget →
approval, and only dispatched if the protocol allows it.

This is the "AgentCover" entry for **CALL-E: Your Code Is Calling**. CALL-E dials;
AgentCover keeps the call inside least-privilege scope, a hard budget, a human
approval gate, and an immutable audit trail — then wraps it in an insurance
interface that turns the audit trail into claims-ready evidence.

## Why this fits CALL-E

The hackathon rewards projects that (1) call CALL-E at runtime, (2) are a
non-obvious use of the platform, (3) are reusable by the community, and
(4) demo clearly. This app is **not** "an AI that makes phone calls" — it is the
safety layer that should sit in front of every production phone agent. The
gating logic is a portable reference implementation any CALL-E builder can drop
in: a `rule` file, a `gate` call, done.

## How it works

```
agent / scheduler
      │  propose: run_call(task, recipient, ...)
      ▼
AgentCover CallGate.gate(...)
      │  1. BINDING      — agent tied to a human owner
      │  2. KILL SWITCH   — frozen? block everything
      │  3. SCOPE         — allowlisted verb + target + params, deny-by-default
      │  4. BUDGET        — would this exceed the $ ceiling?
      │  5. APPROVAL      — costly or critical? needs human sign-off
      ▼
   ALLOWED  ──►  CalleClient.calls.create_and_wait(...)   (real SDK)
   BLOCKED   ──►  no call placed, reason recorded
   PENDING   ──►  human approves via token, then dispatched
```

Every decision is written to an immutable, hash-chained `AuditTrail`. The audit
trail is the input to the insurance interface: it proves what the agent did,
bounded by whom, and is claims-ready if a call ever causes harm.

## Real CALL-E usage (offline-safe)

The app imports the official `calle-ai` SDK and calls
`CalleClient.calls.create_and_wait(...)` **at runtime**. In the default
`--dry-run` / `--demo` modes it slips an `httpx.MockTransport` underneath the
real client, so the **exact SDK request is built, the idempotency header is
attached, and the call is polled to a terminal state — with zero network and no
real call placed.** This is the same honest verification pattern the repo's own
`kept` and `consent-gate` apps use.

Live calls require `CALLE_API_KEY` and `--execute`.

```bash
python -m agentcover_callgate demo          # offline, full gate walkthrough
python -m agentcover_callgate gate examples/appointment.json --dry-run
CALLE_API_KEY=... python -m agentcover_callgate gate examples/appointment.json --execute
```

## Safety by default

- **Deny-by-default scope.** A verb not in the closed vocabulary is blocked
  before any rule is consulted. The allowlist is narrow: exact recipients,
  bounded params, a per-action cost cap.
- **Fail-closed.** Out-of-scope, over-budget, or unapproved → no call.
- **No PHI in logs.** Recipient phone numbers are fingerprinted (SHA-256) in the
  audit trail, never written in the clear.
- **Kill switch.** `AgentCoverCallGate.kill(reason)` freezes the protocol; all
  further calls are blocked until `unfreeze()`.
- **Insurable.** `insurance.report()` emits an underwriter-ready summary and a
  claims-ready evidence bundle straight from the audit trail.

## Layout

```
agentcover-callgate/
├── README.md
├── pyproject.toml
├── agentcover_callgate/
│   ├── __init__.py
│   ├── __main__.py          # CLI: gate / demo / status / kill
│   ├── gate.py              # CallGate: wraps CALL-E in SafetyProtocol
│   ├── rules.py             # default HIPAA scheduler scope rules
│   ├── insurance.py         # claims-ready evidence from the audit trail
│   └── mock_calle.py        # offline MockTransport (no network, no real call)
├── examples/
│   └── appointment.json     # a sample in-scope call plan
└── tests/
    └── test_gate.py         # gate allow / block / kill / budget / approval
```

## Submission

Open a PR to
[`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents)
under `apps/python/agentcover-callgate/`, and link it from the Devpost form
alongside the demonstration video.
