---
name: call-attest-challenge-auth
description: One-time spoken challenge-response for agent-to-agent CALL-E calls. craft generates a nonce plus a 4-token response code derived from HMAC-SHA256(shared secret, nonce) - the secret comes from an environment variable, never the command line - and a plan_call goal that speaks the nonce and asks for the code (the expected code stays local). verify checks the finished transcript's reply against the expected code with digit-word and confusables normalization plus Levenshtein-1 fuzzy matching, and a JSONL nonce ledger flags reuse as REPLAY_SUSPECTED. Companion to dialtone-handshake; proves one-time pre-shared coordination, resists nonce replay, and gives no man-in-the-middle resistance (stated honestly). Heuristic mode only, runs offline.
license: MIT
---

# call-attest-challenge-auth

> **A spoken password, good exactly once.**

`dialtone-handshake` recognizes that the other end of the line is also an
AI. This skill is its cryptographic companion: before two automated
assistants exchange anything sensitive, one challenges the other to reply
with a one-time code derived from a pre-shared secret. A code that matches
proves coordination; a nonce that was already used proves replay.

## When To Use

- before machine-to-machine CALL-E calls between parties that share a
  secret out-of-band and want proof the right counterparty answered
- to detect replay of a previously-used challenge
- to generate the challenge goal for `plan_call` and the expected code to
  verify against

## When Not To Use

- to recognize whether the other end is AI at all; use
  `dialtone-handshake`
- to authenticate humans; spoken codes leak through the audio channel to
  anyone listening
- against a determined man-in-the-middle who can hear and relay the code;
  this protocol does not defend against that (see safety.md)
- as real cryptography for high-value operations; it is a coordination
  proof over a phonetic channel

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

## Why a spoken code and not an audio watermark

Acoustic watermarking (AudioSeal, SilentCipher) embeds inaudible
signatures in high-frequency spectral content - which the 8 kHz telephone
band largely removes before the audio arrives. A spoken code survives the
phone network by design because it is speech.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Proactive Detection of Voice Cloning with Localized Watermarking / AudioSeal (ICML 2024, arXiv 2401.17264) | Localized audio watermarking; background for why watermarking fails on the telephone band |
| SilentCipher: Deep Audio Watermarking (Interspeech 2024, arXiv 2406.03822) | Deep audio watermarking; same background motivation |

Neither watermarking scheme is used here; they motivate the spoken-code
design by showing where inaudible watermarks break on PSTN.

## Differences from sibling skills

- `dialtone-handshake` recognizes the other end is AI and switches modes;
  this skill proves one-time pre-shared coordination with a specific
  counterparty.
- `call-fraud-shield` detects scam patterns in conversations; this skill
  authenticates machine counterparty coordination before content flows.
