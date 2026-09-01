# ScopeSignal — CALL-E Submission Packet

## Title

ScopeSignal

## One-line summary

ScopeSignal uses one explicitly authorized CALL-E call to verify whether a prospective client has final decision authority, unconditional funding, a bounded project scope, and concrete payment terms before a human freelancer decides whether to accept the work.

## Problem

Freelancers and small agencies lose time and money when a promising project is not actually ready to start: the caller cannot approve the work, the deposit is only planned rather than funded, exclusions are vague, access is unavailable, or acceptance criteria appear after delivery. A generic AI summary can make this worse by converting ambiguous statements into confident fields.

The real-world phone task is narrow: contact one explicitly authorized prospective-client representative, verify a fixed project brief without negotiating or accepting anything, and return an evidence-completeness recommendation for human review.

## Solution

ScopeSignal freezes the authorized recipient, project context, exact CALL-E task, result schema, language, region, and one-call safety controls into a SHA-256 approval digest. The local tool defaults to preview, has no networking or provider execution code, and never places a call.

A CALL-E-capable host may execute the documented `plan_call -> run_call -> get_call_run` sequence only after the exact digest is approved. The full recipient is available only through a separate explicit handoff command that writes a requested `0600` file and never prints the sensitive payload.

After a terminal result, ScopeSignal reconciles each field against one substantive complete sentence from exactly one callee turn. It derives values with conservative field-specific parsers rather than trusting provider-generated fields. Agent speech, short generic answers, duplicate quotes, contradictory values, broad negation, refusal, voicemail, and non-completed outcomes fail closed.

The deterministic result is:

- `NO-GO` when the call did not complete, the callee refused, identity is missing, or authority is not sole and final.
- `GO` only when all required facts are transcript-grounded, funding is unconditional, and risks are explicitly absent.
- `CAUTION` for every other completed and authorized case.

These labels describe evidence completeness only. A human owns the final accept/reject decision.

## Why this matters

ScopeSignal is not another lead-scoring or sales-qualification workflow. It protects the service provider before work begins. The commercially important distinction is that a large budget claim is insufficient: the same caller must establish final project authority, unconditional funding, payment timing, delivery boundaries, access prerequisites, acceptance criteria, and the absence of unresolved risks with transcript-grounded evidence.

It gives a one-person business a repeatable pre-engagement control without automating negotiation, contract acceptance, spending, or payment decisions.

## Technical highlights

- Dependency-free Python 3 implementation.
- Closed, recent, purpose-bound authorization schema.
- Stable digest and idempotency key bind authorization, recipient, task, schema, project context, and execution safety controls.
- Exactly one recipient and one attempt; no retry or recurrence.
- Complete-sentence callee evidence only; no agent-speech grounding.
- Conservative authority, funding, and risk state parsers.
- Fail-closed handling for quote/value contradiction and duplicate evidence.
- Phone, email, numeric account, slash-separated account, and long alphanumeric account redaction.
- Explicit `0600` handoff file; sensitive payload never reaches stdout/stderr.
- 26 automated tests plus two independent adversarial reviews.

## Testing instructions

1. Clone PR branch `tasuodi:feat/scope-signal` from the official community repository.
2. Use Python 3.11+.
3. Run `python3 -m unittest discover -s skills/scope-signal/tests -v`.
4. Run the no-call preview:
   `python3 skills/scope-signal/scripts/scope_signal.py preview --input skills/scope-signal/assets/go-input.json`
5. Confirm `call_placed: false`, masked contact, exact task/schema, one-attempt controls, digest, and idempotency key.
6. Run deterministic reconciliation:
   `python3 skills/scope-signal/scripts/scope_signal.py reconcile --input skills/scope-signal/assets/go-input.json --fixture skills/scope-signal/assets/go-result.json`
7. Repeat with the caution and no-go fixtures to inspect all classifications.
8. Run `python3 scripts/validate_repository.py` from the repository root.

No credentials, network access, or phone call are required for the judged path.

## Official form fields

- Submitter Type: Individual
- Country of residence/incorporation: must be supplied truthfully by the submitter
- Organization name: leave blank unless applicable
- App status: Newly created
- Pre-existing explanation: Not applicable — ScopeSignal was created during the submission period
- Functional demo URL: optional; repository CLI is the functional no-call demo
- Project submission pull request URL: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/276
- Email associated with CALL-E account: must be confirmed by the submitter
- Primary use case: Other
- One-sentence real-world task: Calls one explicitly authorized prospective-client representative to verify final authority, unconditional funding, bounded scope, payment terms, delivery prerequisites, and unresolved risks before a human freelancer decides whether to accept the project.
- Eligible Age / Country eligibility / Conflict of interest: must be affirmed truthfully by the submitter
- Demo video URL: pending public YouTube or Vimeo upload

## Evidence status

- Upstream PR: open, non-draft, mergeable
- Automated tests: 26/26 pass
- Official repository validator: pass
- Python compilation: pass
- Whitespace/diff check: pass
- Live CALL-E call: not claimed; no call was placed during development or testing
