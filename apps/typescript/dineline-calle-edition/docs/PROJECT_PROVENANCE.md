# DineLine Project Provenance

Verified from Gregory Schwartz's local Git history on September 10, 2026.

## Why this record exists

The CALL-E Hackathon includes a restaurant-agent example. DineLine's restaurant
discovery and phone-booking concept predates the hackathon submission period.
This record separates that earlier work from the new CALL-E-specific engineering
in this contribution.

## Dated history

### DineLine V1, April 2026

Gregory Schwartz designed and built DineLine V1 for the ODSC AI Engineering
Accelerator capstone. The local repository begins with commit `68220f8` on April
12, 2026. Commit `12ca50b` on April 16 records a working AI-to-AI restaurant
reservation, and the repository contains the April 27 capstone presentation.

### DineLine V2, May 2026

Greg rebuilt DineLine over Memorial Day weekend as a leaner, reusable voice-agent
platform. Local commit `fef94ba` records the initial V2 build on May 25, followed
by phone-booking, n8n, rejection-path, result-return, and silence-handling work.

### CALL-E Edition, September 2026

The CALL-E rules state that the submission period began July 23, 2026 and permit
an existing project that receives a significant update during the submission
period. This edition is that update.

## Work that predates the hackathon

- Restaurant discovery and ranked recommendations
- Collection of reservation details
- A separate phone action for the booking request
- Workflow orchestration and return of the call result
- Greg's hands-on Vapi agents, prompts, tools, webhooks, and n8n nodes

## Work added for this edition

- Two native CALL-E SDK roles with independent permissions
- Strict intake and booking result schemas
- Immutable approval fingerprints and separate idempotency journals
- Fail-closed handling for ambiguous dispatch and contradictory evidence
- Per-agent, server-side real-call gates and destination allowlists
- A sanitized n8n integration with no Vapi runtime dependency
- A fixture-only public interface, Vercel adapter, and automated test suite

## Accurate submission framing

DineLine CALL-E Edition is a substantial CALL-E-native adaptation of an existing
project conceived and built by Gregory Schwartz. The contribution does not claim
that DineLine itself was created during the hackathon. It claims the CALL-E
integration, safety architecture, verification layer, interface, tests, and
public contribution as the new work for this edition.

Official rules: https://call-e.devpost.com/rules
