# ProofMesh

A consent-first CALL-E phone verification platform that turns supervised conversations into auditable, machine-readable facts with human approval, regional controls, and honest uncertainty handling.

- Repository: [https://github.com/fokrulanthro16-eng/proofmesh](https://github.com/fokrulanthro16-eng/proofmesh)
- Demo video: [https://www.youtube.com/watch?v=9-8rcQ7TkNQ](https://www.youtube.com/watch?v=9-8rcQ7TkNQ)
- License: MIT

ProofMesh is hosted in its own repository. It is not a CALL-E SDK and does not define a supported application API.

## Overview

ProofMesh is a self-hosted web application for teams that need a defensible record of what a phone call established. An operator writes a verification mission, reviews a generated call plan, and explicitly approves it before anything is dispatched. When a call runs, the platform stores the provider's structured result as timestamped facts, flags contradictions between facts, and keeps a complete audit timeline of every state change.

The design goal is honesty about uncertainty. If the platform cannot retrieve a result for a call, the outcome is recorded as `unknown` rather than as a success. A verification is only marked completed when a stored result row exists.

## Setup

Requirements: Python 3.11+, Node.js 20+, and a package manager for each.

```bash
git clone https://github.com/fokrulanthro16-eng/proofmesh.git
cd proofmesh

# Backend
cd apps/api
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ../..

# Frontend workspaces
npm install

# Environment: the shipped defaults are safe (mock provider, real calls off)
cp .env.example .env

# Database: a local SQLite file is used when DATABASE_URL is blank
cd apps/api && alembic upgrade head && cd ../..
```

Run the two services in separate shells:

```bash
cd apps/api && uvicorn proofmesh_api.main:app --reload   # API on :8000
npm run dev:web                                          # web console on :3000
```

Full instructions, environment-variable tables, and test commands are in the repository README.

## CALL-E integration method

ProofMesh talks to the CALL-E REST API directly over HTTPS using an `httpx` client in a provider adapter module. It does not vendor or wrap a CALL-E SDK package, and it does not depend on any unpublished private package.

The adapter is selected by the `CALL_PROVIDER` environment variable. The default value is `mock`, which uses an in-process fake provider and never performs network I/O. Setting `CALL_PROVIDER=calle` selects the live adapter.

## Call side effects

When live dispatch is fully enabled, approving a call plan causes ProofMesh to send an outbound call request to CALL-E, which places a real phone call to the recipient number on the plan. This can ring a real phone, cost money, and be answered by a person.

No other side effects are hidden: there are no background schedulers, no recurring jobs, and no automatic retries that place additional calls. Every dispatch is traceable to one operator approval in the audit timeline.

## Safe testing path with no calls

The default configuration places no calls. Real dispatch requires four independent conditions to all hold:

1. `CALL_PROVIDER=calle` — the live adapter is selected.
2. `REAL_CALLS_ENABLED=true` — the live-call flag is on.
3. The destination country is present in the server-side region allowlist.
4. A slot remains in the database-backed lifetime call ledger, bounded by `REAL_CALLS_MAX_TOTAL`.

If any condition fails, dispatch is refused and recorded as a refusal in the audit timeline. Ledger slots are reserved before the provider is contacted and are never refunded, so a crash mid-dispatch cannot free a slot for reuse.

With the defaults (`CALL_PROVIDER=mock`, `REAL_CALLS_ENABLED=false`) the entire application — missions, approvals, dispatch, facts, contradictions, audit timeline — is exercisable end to end without any outbound call. The automated test suite runs in this mode and mocks the provider transport, so tests never reach the network.

## Confirmation for the submitted build

The submitted build ships with real calls disabled: `REAL_CALLS_ENABLED=false` and `CALL_PROVIDER=mock` are the committed defaults. Enabling live calls is an explicit, opt-in operator action.

## Credential handling

CALL-E credentials are read from environment variables only. They are never committed, never written to the database, never included in API responses, and never rendered in the web UI. The repository ships a `.env.example` with placeholder values, and `.env` files are excluded by `.gitignore`. Provider errors are logged without the request credentials.

Operator sessions use short-lived JWT access tokens with separate refresh tokens, scoped to a workspace.

## Cancellation and duplicate-call protections

- A call plan can be cancelled at any point before approval; cancellation is a terminal state recorded in the audit timeline.
- Approval is single-use. Once a plan has been dispatched, re-approving it is rejected rather than dispatching a second call.
- Dispatch is guarded by an atomic database transaction, so concurrent approval attempts cannot both reserve a slot.
- Do-not-call entries and missing consent block plan creation before an operator can approve anything.
- There are no recurring schedules to cancel, because ProofMesh does not create any.

## Phone-number handling

Numbers are stored in E.164 form and masked wherever they are displayed or logged, for example `+33•••••6789`. Sample and test data use fictional numbers only.

## Boundaries

ProofMesh is a verification workbench, not an emergency, medical, legal, or financial advice system. Calls placed through it should be limited to routine factual verification with a recipient who has consented to being called.
