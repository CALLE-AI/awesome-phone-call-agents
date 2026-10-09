# CallYourAgent

CallYourAgent is a hosted human-escalation layer for autonomous AI agents. When an agent reaches a decision that genuinely needs its owner's judgment, it can use CALL-E to call the owner, capture the decision, and continue the affected work. Owners can also request a callback to get progress or provide durable instructions.

**Contribution area: User-facing Apps.** This directory is a catalog and setup guide for the runnable CallYourAgent web application. The application source is maintained at https://github.com/UnknownGod2011/CallYourAgent.

- **Hosted app:** https://callyouragent.vercel.app
- **Source:** https://github.com/UnknownGod2011/CallYourAgent
- **Primary integration:** remote MCP
- **CALL-E role:** real phone-call transport; credentials remain server-side

## What it does

- Agent-to-owner escalation through a CALL-E phone call.
- Branch-scoped blocking so unrelated agent work can continue.
- Owner callbacks for progress, questions, and steering.
- Durable owner decisions and queued instructions consumed at safe checkpoints.
- Call status and audit history through the control plane.
- MCP access for external agent hosts, with opaque revocable per-agent connection tokens.

The hosted remote MCP currently exposes `request_phone_call`, `get_call_status`, and `pull_human_updates`.

## Setup and usage

1. Open https://callyouragent.vercel.app and create an account.
2. Confirm the account email and sign in.
3. Create an agent and configure its owner connection/phone details.
4. Create a private agent connection and copy the generated MCP configuration. Treat the connection token as a password; it is shown only at creation time and can be revoked.
5. Add the remote MCP configuration to an MCP-compatible host such as Kiro, Claude Code, Codex, Gemini CLI, Antigravity, or another HTTP MCP-capable IDE.
6. Copy the host-specific setup prompt from the CallYourAgent connection page into the agent host.
7. Start the agent and allow it to use CallYourAgent when human judgment or owner steering is actually required.
8. For a live call, the agent must provide an authorized valid E.164 destination and explicit intent. Monitor the call through the dashboard and inspect the resulting status/audit information.

## Side effects and safety

- Calls are real-world side effects and are not placed by default during local development.
- Live calls require explicit operator intent and an authorized valid E.164 destination.
- Never place real CALL-E credentials in an agent prompt, browser, repository, or client-side configuration.
- Connection tokens are scoped to an individual agent and should be revoked if exposed.
- Phone numbers should be masked in logs and summaries; examples use fictional/reserved numbers.
- CallYourAgent does not claim to interrupt an in-flight model/token generation. Owner responses and instructions become durable state and are consumed at safe checkpoints.
- A submitted phone call may not be cancellable once the provider accepts it; closing the browser does not imply that a call was stopped.
- The product is a general agent-control workflow and does not autonomously make consequential medical, legal, financial, employment, or emergency decisions.

## Local no-call demo

The source repository contains a deterministic fake-provider demo that exercises the core control-plane workflow without placing real calls:

```bash
npm ci
npm run demo
```

The repository also provides an operator-console demo:

```bash
npm run demo:operator
```

These paths are intended for repeatable validation without CALL-E credentials or phone charges.

## Integration boundary

CallYourAgent owns agent state, escalation policy, durable human input, checkpoint semantics, authorization, and audit state. CALL-E owns phone-call transport. The application is designed so provider-specific calling details remain behind the provider boundary.
