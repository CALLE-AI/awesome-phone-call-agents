---
name: znak-callops
description: Ask a service provider about availability and price in one authorized phone call, then return full transcript quotations and explicit unknowns without booking anything. Use when the source of each answer matters as much as the answer.
license: MIT
---

# ZNAK CallOps

Turn a bounded service inquiry into a CALL-E plan and an inspectable result. This
skill adds a small executable evidence checker: a completed call is not a verified
answer, and a quote present in a transcript is not independent proof of its truth.

## Setup and verification

Requires Python 3.10+ for the local helper, and an Agent Skills-compatible host
with authenticated CALL-E MCP tools or Python 3.11+ with the optional official SDK
adapter for live calls. Copy this whole directory to
the host's skill directory. For Codex, use `~/.codex/skills/znak-callops/`.
Use [references/call-e.md](references/call-e.md) to connect the official provider.
The helper uses only Python's standard library and never connects to a network.

From the repository root, run the synthetic no-call demonstration:

```bash
python3 skills/znak-callops/scripts/callops.py demo
python3 -m unittest discover -s skills/znak-callops/scripts -p 'test_*.py'
```

Read [references/examples.md](references/examples.md) for inputs, expected results,
and manual verification. These tests exercise local code, not the CALL-E service.
The live host integration has not been verified by a real call in this contribution.
For the optional executable SDK path, read
[references/sdk-dispatch.md](references/sdk-dispatch.md). `dispatch.py` defaults to
a no-network preview and imports the official SDK only after explicit live/read
opt-in. No live CALL-E call has been verified through either path.

## Workflow

1. Establish the user's exact question, service scope, preferred time window,
   known destination, language, and permission to call that recipient for this
   purpose. Read [references/safety.md](references/safety.md) before dispatch.
2. Use `prepare-goal` with the resolved request to produce the bounded call brief.
   Show the masked destination, purpose, and **inquiry only; do not book, accept a
   quote, pay, cancel, or disclose additional personal details**. A request to
   prepare a plan alone does not authorize a phone call.
3. Invoke CALL-E `plan_call` with the user's latest message verbatim in
   `user_input`. Pass only known fields; use the prepared brief as `goal`.
   Follow the live tool schema. A plan does not place a call.
4. After the user clearly authorizes this call and the plan is ready, invoke
   `run_call` once with exactly the returned `plan_id` and `confirm_token`.
   Keep those opaque values out of public artifacts. Retain the returned `run_id`
   in the host's private task record. Follow the recovery rules in the provider
   reference; a timeout is not permission to redial.
5. Read `get_call_run` until a terminal outcome or a monitoring pause. If transcript
   turns are available, preserve their exact text, order, and speaker. Map them to
   the helper's documented input. The provider's response schema is discovered at
   runtime; this normalized packet is local, not a CALL-E wire format.
6. Propose full provider-turn quotations for `availability`, `quoted_price`, and
   `follow_up`. Never clip qualifying words. Run `validate-result` on that packet.
   If the provider exposes only a summary, leave the unsupported fields UNKNOWN.
7. Return the checked quotes and their source pointers. Review relevance and
   ambiguity: the checker verifies quote identity, not semantic interpretation,
   speaker authenticity, provider honesty, or that a time remains available.
   Leave booking and other commitments to a separate user decision.

## Result meaning

- `QUOTED`: one complete provider turn is present in the supplied transcript.
  This is a reported statement, not a verified real-world fact.
- `DISPUTED`: distinct supported quotes remain for one field; show both for review.
- `UNKNOWN`: no acceptable source quote; show the rejected evidence reason.

Keep call status, source mode, and field status separate. `COMPLETED` with no
transcript still yields UNKNOWN answers. `source_mode: synthetic` identifies the
bundled demonstration; a caller-supplied `live` label is not independent attestation.
The helper has no booking API and cannot enforce what a remote voice model says.
Any observed commitment request or boundary breach must be surfaced to the user.
