---
name: auditlane
description: Explore an experimental phone-verification workflow for risky agent actions and undocumented approval claims; use no-call rehearsals and advisory evidence alongside independent human authorization.
license: MIT
---

# AuditLane skill

**Full source:** [github.com/soujasK/AuditLane](https://github.com/soujasK/AuditLane) —
everything below assumes you've cloned it:
```bash
git clone https://github.com/soujasK/AuditLane
cd AuditLane
```

## The actual problem this solves

Autonomous agents increasingly get real execution access — shell commands,
infrastructure changes, database access — through hooks, MCP servers, and
CI pipelines. A common mitigation is "the agent should ask a human before
doing anything dangerous." That's an honor system. A careless, confused,
or compromised agent just doesn't ask, and nothing stops it.

This reference explores placing a supplementary check at a host's
pre-execution hook. The linked implementation targets Claude Code's
`PreToolUse` hook for configured `Bash` tools; read the
[host and safety notes](references/safety.md) before installation.
It is an experimental pattern matcher, not an unskippable security boundary:
nonmatching commands and other execution paths can bypass this check, and
dress-rehearsal fixtures can produce an `allow` response without a real call.
Keep independent human authorization and host permissions in place for real
destructive actions. A phone interpretation alone must not authorize them.

## What it actually does

**1. `telephony-gate` — experimental command-pattern hook**
`auditlane/danger_patterns.py` pattern-matches the command against 22
categories across databases, filesystem, remote-code-execution
(`curl | bash`), infrastructure (terraform/kubectl/docker/cloud CLIs),
git, system control, and package publishing. A match calls the
configured authorizer with a free-recall-first interview ("what did you
discuss/approve regarding X?" *before* reading back the specific claim —
this is the same reason real witness interviews lead with open recall,
not a leading yes/no). The hook uses heuristic confirmation results to propose
an allow/deny decision; rehearsal uses fictional responses. Nonmatching commands
pass through without a verification call. Neither behavior establishes that a
command is safe or that all risky execution paths were covered.

**2. `audit_pr` — the same engine, applied to PR text after the fact**
Scans a PR's title/body for claims of undocumented verbal authorization
("confirmed with X", "the architect verbally cleared this"), places a
call to the named person using the same interview method, compares their
statement against the claim, and returns `verified`, `blocked`, or
`needs_human_review`. If their answer names a *second* person's
approval, the chain continues — that person gets called too, up to a
configurable hop limit — before a verdict is reached.

Both share one verification core (`auditlane/calle_client.py`,
`auditlane/verifier.py`). Its intended policy blocks detected denials, reports
detected uncertainty for human review, and labels matching confirmations
`verified`. These are advisory heuristic labels, not proof of authorization;
they can miss ambiguity or misread a statement.

## Compatibility notes

Pure Python 3.11+, no framework dependency. Requires `calle-ai` (PyPI)
only for live calls; the default dress-rehearsal mode requires nothing
beyond `requests` and `pytest`.

The generic workflow is portable, but host interception is not automatic:
each host needs its own reviewed adapter and independent permission boundary.
The supplied Claude Code adapter covers configured `Bash` hook invocations,
not all tools or all ways to execute a command. See the
[host-specific reference](references/safety.md#host-integration-boundary).

What *is* genuinely portable: the verification core underneath
(`auditlane/danger_patterns.py`, `auditlane/calle_client.py`,
`auditlane/verifier.py`) has zero Claude Code coupling — it's plain
Python that takes a command or a claim and returns a decision. Porting
the enforcement point to a different agent host with an equivalent
pre-execution interception mechanism is a new thin adapter, not a
rewrite of the gate. That's not a promise without evidence, either —
`audit_pr` already ships two other integration surfaces built on the
exact same core: standalone via the CLI
(`run_verification.py`), or as an MCP tool
(`auditlane/mcp_server.py`'s `telephony_verify_action`) callable from
*any* MCP-compatible client today — Claude Desktop or otherwise. That
path is weaker than the hook (an agent has to choose to call it, same
honor-system caveat), but it's real and working now, not aspirational.
`audit_pr` is also wired into any CI system that can run a Python step
and read a PR's title/body — the included GitHub Actions workflow is
one example, not the only one.

The author reports 129 offline tests, development checks against a real `Bash`
hook invocation, and two crash fixes. These reports have not been independently
reproduced as part of this documentation contribution and do not establish an
all-path enforcement guarantee.

## Setup / install

```bash
pip install -r requirements.txt
cp phonebook.example.json phonebook.json   # keep fictional entries for rehearsal
python demo/dress_rehearsal.py             # confirm it runs, zero API key needed
```

**To enable the automatic command gate**, register the hook in your own
project's `.claude/settings.json` — [see AuditLane's own entry for the
exact JSON](https://github.com/soujasK/AuditLane/blob/main/.claude/settings.json),
which registers `hooks/pretooluse_telephony_gate.py` against the `Bash`
matcher — and set who has to answer for a dangerous command:

```bash
export AUDITLANE_HOOK_AUTHORIZER="the security lead"   # a phonebook.json key
```

Leave it unset and the gate fails closed on every dangerous match — it
never silently allows just because nobody configured an authorizer.

**Preview any claim before spending a real call** — the CLI entry point
lives in the cloned repo's `scripts` folder as `run_verification.py`:

```bash
cd scripts
python run_verification.py --dry-run --title "..." --body "..."
```

Use the unmodified external CLI preview only with fictional phonebook entries:
it may print the private request payload. For a real recipient, first prepare a
display-only preview with the phone masked (for example, `+1 *** *** 0142`)
and remove phone/secret text from the displayed prompt. Retain the exact
destination only in private dispatch state; do not copy it to logs or summaries.
Preview itself must not place a call.

**To go live:** `pip install calle-ai`, set `CALLE_API_KEY`, set
`AUDITLANE_DRESS_REHEARSAL=false`. See
[`references/safety.md`](references/safety.md) first.

## Safety notes for real-world side effects

Places real phone calls to real people when live. Dress rehearsal is the
default and must be explicitly disabled. The phonebook (name → phone
number) is always supplied separately and is never derived from the text
being audited or the command being gated, so a fabricated claim — or an
agent that's been prompt-injected into naming a fake authorizer — can't
point the verification call at a number it controls.

The author reports tests for these intended deny paths on matching commands;
they are examples of covered behavior, not exhaustive security guarantees:

- No `AUDITLANE_HOOK_AUTHORIZER` configured → deny
- Authorizer has no phone on file → deny
- Authorizer unreachable → deny
- CALL-E itself errors (balance, network, auth) → deny
- Malformed, missing, or unexpected-shaped hook input (not even valid
  JSON, wrong types, wrong structure) → deny, never a crash
- Caught internal errors → intended deny via a top-level exception handler

The author reports regression tests for two malformed-input bugs in
`tests/test_hook_robustness.py`. Finite tests cannot establish that every
unexpected input, command encoding, or future regression is handled.

A local call-budget guard (`AUDITLANE_MAX_LIVE_CALLS`, default 3) caps
live calls placed per session independent of CALL-E's own balance. This local
budget is not permanent deduplication or crash-proof enforcement. Stop after
an ambiguous call submission; do not redial or continue a conflicting approval
chain until a human has reconciled the existing provider outcome.

Full detail, plus concrete before/after examples of the gate actually
blocking a real command, in
[`references/safety.md`](references/safety.md) and
[`references/examples.md`](references/examples.md).

## Tests

Run from within a clone of AuditLane (see the top of this file):

```bash
python -m pytest tests/ -v
```

The author reports 129 offline tests requiring no network or API key:

- Core verification pipeline: claim extraction, entailment scoring,
  multi-hop chains, fail-closed decision policy
- `test_danger_patterns.py` — 85 cases: 49 real dangerous commands
  (all correctly flagged) and 31 safe/near-miss commands specifically
  chosen to catch false positives (`git branch -d` vs `-D`,
  `UPDATE ... WHERE` vs unscoped, `npm run publish` vs `npm publish`)
- `test_hook_robustness.py` — 18 cases exercising selected malformed,
  missing, oversized, or wrong-typed inputs

## Cancellation / rollback

There is no provider-side recurring job created by this reference. Removing a
CI step or hook entry prevents future invocations; enabling dress rehearsal
changes subsequent invocations only. None of these actions recalls an accepted
outbound call or necessarily stops an already-running process. Check the
provider's actual cancellation capability and result; otherwise report that the
call may continue. A command already executed needs its own recovery procedure.
`audit_pr` statuses are advisory and carry no merge authority of their own.
Do not switch to rehearsal to authorize a real destructive action.

## No secrets or personal data

This skill directory contains no credentials, no real phone numbers, and
no real names — see AuditLane's own
[`phonebook.example.json`](https://github.com/soujasK/AuditLane/blob/main/phonebook.example.json)
and the fixture bank in
[`auditlane/calle_client.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/calle_client.py),
both fictional.
