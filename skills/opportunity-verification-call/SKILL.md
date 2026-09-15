---
name: opportunity-verification-call
description: Verifies a listed local employment or gig opportunity before a person incurs downstream costs by using a bounded CALL-E phone call to gather structured evidence.
---

# Opportunity Verification Call

## Purpose
A focused CALL-E Agent Skill for verifying a listed local employment or gig opportunity before a person incurs downstream costs (travel, printing, airtime, or application effort). 

Unlike skills that screen candidates or verify digital bounties (e.g., `bounty-screening-call`), this skill focuses on the physical-world cost of uncertainty in local gig economies. It asks: *Is the opportunity still open? Where is it? What is the compensation and application path?*

The workflow takes an existing opportunity plus an explicitly approved contact, prepares a bounded verification task, and uses CALL-E to gather structured phone evidence.

This is an instructional reference, not an included CALL-E adapter or host runtime.
Read [the safety rules](references/safety.md) before use and follow
[the fictional example](references/examples.md) for a no-call walkthrough.

## Host execution sequence

1. Start with a no-call preview: collect the opportunity ID, bounded questions,
   and an operator-authorized contact. Validate the private destination as E.164
   and show only a masked number in the preview.
2. Obtain explicit approval for this one call and its questions. The host must
   supply its supported CALL-E integration, secure credential storage, and the
   same stable intent key for this opportunity/contact task where supported.
   If the host cannot meet the safety rules, remain in preview mode.
3. Submit at most one call for that approved intent. Record its provider ID and
   status in private host state; do not create a recurring schedule.
4. If submission or completion is ambiguous, mark it `UNKNOWN` and stop. Do not
   automatically redial, create a fresh intent, or take a conflicting downstream
   action. A human must reconcile the existing provider state first.
5. Present a masked, advisory receipt separating call status, transcript evidence,
   and extracted claims. A person decides whether to act on the opportunity;
   this skill does not establish employer identity or guarantee an offer is valid.

## Core Principles (The Governance Boundary)
The contribution deliberately separates:
1. Call completion
2. Transcript evidence
3. Structured extraction
4. Downstream verification state

A successful call alone is not treated as proof that an opportunity is valid. Ambiguous, missing, or contradictory answers remain available for downstream reconciliation (like Partial Knowable Algebra) rather than being automatically converted into certainty.
