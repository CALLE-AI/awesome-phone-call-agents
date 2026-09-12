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

## Setup & Configuration

```bash
pip install -r requirements.txt
cp phonebook.example.json phonebook.json   # configure verified internal directory
python demo/dress_rehearsal.py             # confirm execution in zero-cost offline mode
```

To enable live telephony: install `calle-ai`, set `CALLE_API_KEY`, and set `CHRONO_AUDIT_DRESS_REHEARSAL=false`. Consult `references/safety.md` before initiating live calls.

## Safety & Governance

This skill initiates telephone calls to human contacts when live mode is enabled. Dress rehearsal mode is the default and simulates realistic interview responses without placing calls. For complete governance rules, anti-spoofing controls, and rate-limiting guidelines, see `references/safety.md`.

## Verification Examples

For end-to-end trace walkthroughs of denied authorizations, multi-hop delegation chains, and unreachable authorizer handling, see `references/examples.md`.
