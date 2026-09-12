---
name: chrono-audit
description: Verify autonomous coding-agent verbal human authorization claims by placing a CALL-E phone call before pull requests can merge.
---

# CHRONO-AUDIT

A merge-gate verification check for coding-agent pull requests. Scans PR descriptions and commit messages for claims of undocumented verbal human authorization ("confirmed with X", "the architect verbally cleared this"), places a CALL-E call to the named person using an open-recall-first interview method, compares their statement against the claim via entailment, and outputs a strict merge verdict: `verified`, `blocked`, or `needs_human_review`.

## When To Use

Use this skill when:
- An autonomous coding agent (Devin, SWE-agent, OpenHands) opens a PR asserting verbal clearance.
- A proposed change involves critical actions (schema drop, key rotation, permission escalation).
- No digital approval trail (ticket, signed commit, PR review approval) exists for the verbal claim.
- Out-of-band telephone verification of the claimed authorizer is required before merging.

## When Not To Use

Do not use this skill to:
- Replace static analysis, unit test suites, or standard digital code reviews.
- Dial phone numbers extracted from the PR text itself (always consult an internal directory).
- Force confirmation when an authorizer denies or hedges a claim.

## Enterprise Tool Suite

CHRONO-AUDIT provides a full verification ecosystem for autonomous agents:

1. **`telephony-sudo` CLI Sandbox Interceptor**: Intercepts high-blast-radius terminal commands (e.g. `DROP DATABASE`, `terraform destroy`) executed by agents (Devin, Claude Code), freezes execution, dials the designated human authorizer with an anti-spoofing challenge nonce, and unfreezes only upon affirmative verbal confirmation.
2. **`git voice-blame`**: Inspects Git commits or repository lines to display immutable cryptographic voice provenance cards (HMAC-SHA256 signatures, recording hashes, caller timestamps) stored in Git notes.
3. **Model Context Protocol (MCP) Server**: Exposes standard MCP tools (`telephony_verify_action`, `audit_pr_verbal_claims`, `voice_blame_commit`) directly to Claude Code, Cursor, and ChatGPT agents.
4. **Voice-to-Diff Healing**: When an authorizer verbally modifies a plan (e.g., "keep table until Q3 migration"), CHRONO-AUDIT synthesizes a git patch reflecting the spoken amendment.

## Setup & Configuration

```bash
pip install -r requirements.txt
cp phonebook.example.json phonebook.json   # configure verified internal directory
python demo/dress_rehearsal.py             # confirm execution in zero-cost offline mode
```

To enable live telephony: install `calle-ai`, set `CALLE_API_KEY`, and set `CHRONO_AUDIT_DRESS_REHEARSAL=false`. Consult `references/safety.md` before initiating live calls.

### CLI & Tools Usage

```bash
# Agent CLI privilege gate
python scripts/telephony_sudo.py --cmd "DROP TABLE legacy_users;" --authorizer "@sarah_dba"

# Voice provenance audit
python scripts/git_voice_blame.py --commit HEAD

# Start Model Context Protocol (MCP) server for Claude Code / Cursor
python -m chrono_audit.mcp_server

# Launch Web Verification Console
python scripts/serve_ui.py --port 8080
```

## Safety & Governance

This skill initiates telephone calls to human contacts when live mode is enabled. Dress rehearsal mode is the default and simulates realistic interview responses without placing calls. For complete governance rules, anti-spoofing controls, and rate-limiting guidelines, see `references/safety.md`.

## Verification Examples

For end-to-end trace walkthroughs of denied authorizations, multi-hop delegation chains, `telephony-sudo` command freezes, and `git voice-blame` provenance, see `references/examples.md`.

