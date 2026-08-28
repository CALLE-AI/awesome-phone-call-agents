# AgentCover CALL-E Call Gate (experimental demo)

> **Demo only.** This is an *experimental, in-memory* demonstration of a
> bounded-autonomy gate in front of CALL-E phone calls. The audit trail and
> gating state live in memory for the lifetime of the process — they are
> **not** a production system of record, **not** immutable, and **not**
> claims-ready. The point is to show the *shape* of the safety layer
> (binding, scope allowlist, budget, kill switch) a real CALL-E deployment
> should sit behind.

A bounded-autonomy gate that wraps every CALL-E phone call in a small,
vendored enforcement layer. The agent never dials directly — every `run_call`
intent is translated into an `ActionRequest`, passed through binding → kill
switch → scope → budget → approval, and only dispatched if the gate allows it.

This is the "AgentCover" entry for **CALL-E: Your Code Is Calling**. CALL-E
dials; AgentCover shows the gate that should sit in front of it: least-privilege
scope, a hard budget, a human kill switch, and an in-memory decision log.

## Why this fits CALL-E

The hackathon rewards projects that (1) call CALL-E at runtime, (2) are a
non-obvious use of the platform, (3) are reusable by the community, and
(4) demo clearly. This app is **not** "an AI that makes phone calls" — it is
the *safety layer* that should sit in front of every phone agent. The gating
logic is a portable reference any CALL-E builder can drop in: a `rule` file, a
`gate` call, done.

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
   BLOCKED   ──►  no call placed, reason recorded (in memory)
   PENDING   ──►  human approves via token, then dispatched
```

Every decision is written to an **in-memory** `AuditTrail`. In this demo that
log is a teaching artifact, not durable evidence — it is re-derived in memory
and can be inspected via `insurance.report(gate)`.

## Real CALL-E usage (offline-safe)

The app imports the official `calle-ai` SDK and calls
`CalleClient.calls.create_and_wait(...)` **at runtime**. In the default
`--dry-run` / `--demo` modes it slips an `httpx.MockTransport` underneath the
real client, so the **exact SDK request is built, the idempotency header is
attached, and the call is polled to a terminal state — with zero network and no
real call placed.** This is the same honest verification pattern the repo's own
`kept` and `consent-gate` apps use.

Live calls require `CALLE_API_KEY` and `--execute`, and **every live recipient
must be strict E.164** (`+` followed by 1–15 digits). Live requests are
restricted to the official origin `https://api.heycall-e.com` — a custom or
`http://` base URL with credentials is rejected.

```bash
pip install -e .
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
- **Kill switch.** `AgentCoverCallGate.kill(reason)` freezes the gate; all
  further calls are blocked until `unfreeze()`.
- **E.164 enforcement.** Live dispatch refuses any recipient that is not strict
  E.164 (`is_e164`).
- **Official-origin only.** Live SDK calls use `https://api.heycall-e.com`;
  credentials are never sent to a non-official origin.

## Scope of this demo

- ✅ Shows the gating *shape* (binding, scope, budget, kill switch, approval).
- ✅ Calls the real `calle-ai` SDK at runtime (offline via MockTransport).
- ✅ 6 tests pass (allow / block-verb / block-recipient / budget / kill / E.164).
- ❌ **Not** a production system of record. The audit trail is in-memory and
  experimental; it is **not immutable and not claims-ready**.
- ❌ **Not** an insurance product. `insurance.report()` is a demo summary, not
  an underwriting or claims artifact.

## Layout

```
agentcover-callgate/
├── README.md
├── pyproject.toml
├── agentcover_callgate/
│   ├── __init__.py
│   ├── __main__.py          # CLI: gate / demo / status / kill
│   ├── gate.py              # CallGate: wraps CALL-E in the vendored engine
│   ├── _engine.py           # minimal vendored enforcement engine (in-memory)
│   ├── rules.py             # default HIPAA scheduler scope rules
│   ├── insurance.py         # DEMO evidence summary (not claims-ready)
│   └── mock_calle.py        # offline MockTransport (no network, no real call)
├── examples/
│   └── appointment.json     # a sample in-scope call plan
└── tests/
    └── test_gate.py         # gate allow / block / kill / budget / E.164
```

## Submission

Open a PR to
[`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents)
under `apps/python/agentcover-callgate/`, and link it from the Devpost form
alongside the demonstration video.
