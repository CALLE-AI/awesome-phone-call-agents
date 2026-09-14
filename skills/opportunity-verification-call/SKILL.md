---
name: opportunity-verification-call
description: Verifies a listed local employment or gig opportunity before a person incurs downstream costs by using a bounded CALL-E phone call to gather structured evidence.
---

# Opportunity Verification Call

## Purpose
A focused CALL-E Agent Skill for verifying a listed local employment or gig opportunity before a person incurs downstream costs (travel, printing, airtime, or application effort). 

Unlike skills that screen candidates or verify digital bounties (e.g., `bounty-screening-call`), this skill focuses on the physical-world cost of uncertainty in local gig economies. It asks: *Is the opportunity still open? Where is it? What is the compensation and application path?*

The workflow takes an existing opportunity plus an explicitly approved contact, prepares a bounded verification task, and uses CALL-E to gather structured phone evidence.

## Core Principles (The Governance Boundary)
The contribution deliberately separates:
1. Call completion
2. Transcript evidence
3. Structured extraction
4. Downstream verification state

A successful call alone is not treated as proof that an opportunity is valid. Ambiguous, missing, or contradictory answers remain available for downstream reconciliation (like Partial Knowable Algebra) rather than being automatically converted into certainty.