---
name: call-right-party-gatekeeper
description: Offline experimental CALL-E transcript helper that compares recognized callee confirmation phrases with detected sensitive-disclosure keywords. Returns advisory right-party signals, an ordering flag and a suggested verification-first goal. It does not verify identity, certify compliance, authorize disclosure or place calls.
license: MIT
---

# call-right-party-gatekeeper

> **Verify who is listening before saying what matters.**

In collections, healthcare, and any sensitive outreach, disclosing account
or medical details to the wrong listener is a compliance failure even when
the call otherwise goes well. This skill audits finished CALL-E calls for
the ordering question: did the agent confirm the recipient before the first
sensitive disclosure keyword? This is an advisory English phrase check,
not identity verification or legal-compliance certification.

## When To Use

- after an authorized CALL-E call, to flag recognized confirmation/disclosure
  ordering for human review, not to prove identity or permission to disclose
- to detect wrong-party answers ("wrong number", "can I take a message")
  and third-party answers ("who is this calling?", "he is busy right now")
- to generate a verification-first goal for the next `plan_call` that
  parks politely and reveals nothing until identity is confirmed

## When Not To Use

- to detect fraud or scam patterns in the conversation; use
  `call-fraud-shield`
- to audit general call quality, disclosure of being an AI agent, or
  result-vs-transcript consistency; use `call-review`
- during a call; CALL-E exposes transcripts, not live audio, so this is a
  post-call audit plus a pre-call goal template
- as proof of who actually answered; regex-level signals miss many
  phrasings and the card says so

## Workflow

### Analyze a finished call

```bash
python3 scripts/gatekeeper.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `right_party_status`: CONFIRMED / WRONG_PARTY / THIRD_PARTY_PRESENT /
  UNVERIFIED
- `verification_before_disclosure`: ordering flag (false when disclosure
  preceded the first recognized callee confirmation or no confirmation was
  recognized; only detected phrases are compared)
- `evidence`: turn index, masked span, signal type for every detected
  verification question, identity confirmation, wrong-party signal,
  third-party signal, and sensitive disclosure
- `gate_assessment: "unclear"` with a reason when one side never spoke
- `recommended_action`: `proceed`, `stop_and_retry_with_script` (with the
  verification-first goal text), or `human_review` (with review guidance)

All action labels are review suggestions. `proceed` never authorizes sensitive
disclosure or a consequential action; `stop_and_retry_with_script` never
authorizes another call. The operator must independently verify identity,
decide what can be disclosed and approve any new call.

### Craft the verification-first goal

```bash
python3 scripts/gatekeeper.py craft --scenario sensitive-outreach --language en
```

Emits the plan_call inputs JSON whose `goal` is the same template the card
recommends on `stop_and_retry_with_script`, so audit and next call stay
consistent.

## Practice grounding

Right-party contact verification and third-party disclosure limits are
long-standing practice in collections and healthcare outreach (for example
FDCPA third-party disclosure rules and HIPAA minimum-necessary handling).
This skill illustrates a narrow phrase-ordering review for CALL-E transcripts;
it is not a legal assessment and claims no research results.

## Differences from sibling skills

- `call-review` audits call quality and compliance generally (including
  sensitive readbacks); this skill specializes in the single ordering
  question - was the recipient verified before content - and produces a
  ready-to-use retry script.
- `call-fraud-shield` detects scams; this skill assumes the caller is
  legitimate and audits its own disclosure hygiene.
