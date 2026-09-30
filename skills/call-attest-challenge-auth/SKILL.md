---
name: call-attest-challenge-auth
description: Offline experimental spoken-code coordination illustration for CALL-E workflows. Generates a nonce and HMAC-derived short code from an environment-variable secret, then fuzzy-matches a supplied transcript against the supplied expected code. An optional local JSONL ledger flags recorded nonce reuse. This is not identity authentication, a secure replay guarantee or permission to disclose sensitive information.
license: MIT
---

# call-attest-challenge-auth

> **An offline spoken-code coordination experiment.**

This companion to `dialtone-handshake` generates an illustrative short code
derived from a pre-shared secret and checks a supplied transcript for a
fuzzy match. A matching code is only a text-level coordination signal;
recorded nonce reuse may indicate replay or an operator error. Neither
result authenticates a counterparty or authorizes sensitive disclosure.

## When To Use

- to rehearse a coordination exchange between consenting test participants
- to flag a challenge recorded in the optional local nonce ledger
- to generate the challenge goal for `plan_call` and the expected code to
  verify against

## When Not To Use

- to recognize whether the other end is AI at all; use
  `dialtone-handshake`
- to authenticate humans; spoken codes leak through the audio channel to
  anyone listening
- against a determined man-in-the-middle who can hear and relay the code;
  this protocol does not defend against that (see safety.md)
- to authorize sensitive disclosure or any financial, medical, employment,
  safety or other consequential operation, even when the label is VERIFIED

## Workflow

### Craft the challenge

```bash
CALL_ATTEST_SECRET=<shared secret> python3 scripts/attest_auth.py craft --scenario attestation-call --language en
```

Reads the secret from the environment (never the command line), generates
a nonce, derives the 4-token code (2 colors + 1 number word + 2 digits)
from HMAC-SHA256(secret, nonce), and emits the plan_call goal that speaks
the nonce. The expected code travels in the craft output only - keep it
local.

### Verify a finished call

```bash
python3 scripts/attest_auth.py verify --transcript path/to/call-result.json --nonce <nonce> --expected-code "BLUE ORANGE SEVEN 42" --ledger nonce-ledger.jsonl
```

Checks that an agent turn spoke the nonce and a callee turn replied;
normalizes tokens (digit strings expand to digit words, FOR/TO/WON
confusables fold) and fuzzy-matches with edit distance <= 1 per token in
order. Emits a card:

- `attestation`: VERIFIED / FAILED_NO_RESPONSE (reason
  challenge_not_spoken or no_response_after_challenge) /
  FAILED_MISMATCH / REPLAY_SUSPECTED
- `evidence`: masked spans with kinds challenge_spoken and response_heard
- `recommended_action`: accept_and_continue / reject_caller /
  investigate_replay
- With `--ledger`: a verified nonce is appended to the JSONL ledger; a
  nonce already present yields REPLAY_SUSPECTED.

`VERIFIED` and `accept_and_continue` are legacy output labels for an advisory
fuzzy match, not authentication decisions. Without a ledger reuse is not
checked. The local ledger is sequential-only, not a durable or concurrent
replay defense. Inputs must come from a trusted operator; empty values and
altered transcripts are not a security boundary.

## Why a spoken code and not an audio watermark

This example uses text-level spoken-code matching because it needs no audio
model. It does not benchmark watermarking or spoken codes over telephone
networks, and makes no claim that AudioSeal or SilentCipher necessarily fails
on the PSTN. Audio quality and transcription errors remain limitations.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Proactive Detection of Voice Cloning with Localized Watermarking / AudioSeal (ICML 2024, arXiv 2401.17264) | Background on localized audio watermarking; not implemented or evaluated here |
| SilentCipher: Deep Audio Watermarking (Interspeech 2024, arXiv 2406.03822) | Background on deep audio watermarking; not implemented or evaluated here |

Neither watermarking scheme is used here. These references do not validate
this short-code design or establish telephone-band performance.

## Differences from sibling skills

- `dialtone-handshake` proposes an agent-to-agent handshake; this skill
  illustrates a separate offline spoken-code check without switching modes.
- `call-fraud-shield` detects scam patterns in conversations; this skill
  provides an advisory coordination signal, not counterparty authentication.
