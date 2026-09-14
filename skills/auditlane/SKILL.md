---
name: auditlane
description: Gates dangerous agent actions (DROP TABLE, rm -rf, terraform destroy, force-push, curl-pipe-to-shell, and 19 other patterns) behind a real, live phone call to a human before they're allowed to execute, as a Claude Code PreToolUse hook the agent cannot skip; also audits PR text for undocumented claims of verbal human approval by calling the named person to check, failing closed on every error path.
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

This skill's actual contribution isn't the phone call — it's *where the
gate lives*. Instead of trusting the agent to voluntarily request
verification, it installs as a **Claude Code `PreToolUse` hook**, which
means every `Bash` command the agent tries to run passes through it
*before execution*, unconditionally. The agent has no code path that
skips it. If the command matches a dangerous pattern, execution is
blocked until a real, live phone call to a configured human is
explicitly confirmed.

## What it actually does

**1. `telephony-gate` — automatic, can't-be-skipped command gating**
`auditlane/danger_patterns.py` pattern-matches the command against 22
categories across databases, filesystem, remote-code-execution
(`curl | bash`), infrastructure (terraform/kubectl/docker/cloud CLIs),
git, system control, and package publishing. A match calls the
configured authorizer with a free-recall-first interview ("what did you
discuss/approve regarding X?" *before* reading back the specific claim —
this is the same reason real witness interviews lead with open recall,
not a leading yes/no) and only allows the command through on an explicit
verbal confirmation. Everything else passes through untouched, with zero
added latency.

**2. `audit_pr` — the same engine, applied to PR text after the fact**
Scans a PR's title/body for claims of undocumented verbal authorization
("confirmed with X", "the architect verbally cleared this"), places a
call to the named person using the same interview method, compares their
statement against the claim, and returns `verified`, `blocked`, or
`needs_human_review`. If their answer names a *second* person's
approval, the chain continues — that person gets called too, up to a
configurable hop limit — before a verdict is reached.

Both share one verification core (`auditlane/calle_client.py`,
`auditlane/verifier.py`) and one decision policy: any denial or confident
contradiction blocks; every hop confirmed with confident entailment
verifies; anything else — unreachable, no phone on file, ambiguous,
internal error — fails closed to a human, never to a guess.

## Compatibility notes

Pure Python 3.11+, no framework dependency. Requires `calle-ai` (PyPI)
only for live calls; the default dress-rehearsal mode requires nothing
beyond `requests` and `pytest`.

**On portability, explicitly:** most skills in this directory are
written as agent-agnostic instruction patterns — any capable AI system
could follow them. `telephony-gate` is deliberately different, and it's
worth saying why rather than leaving it implicit. Its entire value is
that the gate is a *real interception point an agent cannot skip* — the
"can't be skipped" part is not a documentation convention, it's a
wire-level guarantee, and that guarantee only exists because it's built
against Claude Code's actual `PreToolUse` stdin/stdout JSON contract. A
fully generic, "any agent could theoretically implement this" version
would just be the honor-system problem this was built to solve, again,
under a different name.

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

**Why Claude Code specifically, not a hypothetical universal target:**
something that provably works against one real, currently-widely-used
agent's actual execution path — 129 tests, fired live against a real
`Bash` tool call during development, two real crash bugs found and
fixed by adversarial testing before anyone else ever saw it — is a
stronger claim than something written to theoretically work everywhere
but verified nowhere. Claude Code is also not an arbitrary pick for this
specific use case: a tool that gates dangerous *agent* actions is
naturally aimed at the agent people are actually giving real execution
access to right now. Narrow-and-proven over broad-and-theoretical is the
deliberate choice here, not a limitation to apologize for.

## Setup / install

```bash
pip install -r requirements.txt
cp phonebook.example.json phonebook.json   # replace with your real org directory
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

Prints the exact phone number, region, and prompt CALL-E would receive —
zero API calls, zero cost.

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

The gate fails closed on every error path, not just the obvious ones —
verified with a dedicated stress-test suite, not just claimed:
- No `AUDITLANE_HOOK_AUTHORIZER` configured → deny
- Authorizer has no phone on file → deny
- Authorizer unreachable → deny
- CALL-E itself errors (balance, network, auth) → deny
- Malformed, missing, or unexpected-shaped hook input (not even valid
  JSON, wrong types, wrong structure) → deny, never a crash
- Any unforeseen internal error → deny, via a top-level catch-all that
  guarantees valid JSON output no matter what breaks upstream

That last set of guarantees exists because two real crash bugs were
found by stress-testing malformed input during development (a
list-shaped payload, a non-string command field) — both fixed, both now
permanently regression-tested in `tests/test_hook_robustness.py` so they
can't silently come back.

A local call-budget guard (`AUDITLANE_MAX_LIVE_CALLS`, default 3) caps
live calls placed per session independent of CALL-E's own balance, so a
retry loop or a misconfiguration can't silently run up real charges.

Full detail, plus concrete before/after examples of the gate actually
blocking a real command, in
[`references/safety.md`](references/safety.md) and
[`references/examples.md`](references/examples.md).

## Tests

Run from within a clone of AuditLane (see the top of this file):

```bash
python -m pytest tests/ -v
```

129 tests, all offline, no network access or API key required:
- Core verification pipeline: claim extraction, entailment scoring,
  multi-hop chains, fail-closed decision policy
- `test_danger_patterns.py` — 85 cases: 49 real dangerous commands
  (all correctly flagged) and 31 safe/near-miss commands specifically
  chosen to catch false positives (`git branch -d` vs `-D`,
  `UPDATE ... WHERE` vs unscoped, `npm run publish` vs `npm publish`)
- `test_hook_robustness.py` — 18 cases proving the hook cannot crash on
  malformed, missing, oversized, or wrong-typed input

## Cancellation / rollback

Stateless per invocation — there is no recurring job to cancel. For
`audit_pr`: removing the CI step (or the GitHub Actions workflow file)
stops all behavior immediately; a `blocked`/`needs_human_review` verdict
is only a commit status / PR comment, carries no merge authority of its
own, and can always be overridden by a human with normal repository
permissions. For `telephony-gate`: deleting the hook entry from your
project's `.claude/settings.json` (or setting
`AUDITLANE_DRESS_REHEARSAL=true` to force every match into the free,
offline mock path) disables it immediately — no state to unwind, no
in-flight job to cancel, since a gated command simply hasn't run yet
when you do either.

## No secrets or personal data

This skill directory contains no credentials, no real phone numbers, and
no real names — see AuditLane's own
[`phonebook.example.json`](https://github.com/soujasK/AuditLane/blob/main/phonebook.example.json)
and the fixture bank in
[`auditlane/calle_client.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/calle_client.py),
both fictional.
