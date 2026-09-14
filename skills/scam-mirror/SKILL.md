---
name: scam-mirror
description: Verify a suspected callback scam by dialing the published official line and the suspect number through CALL-E, comparing what each says, and emitting a trust verdict with evidence hashes. Use when a user wants to check a "please call back this number" claim from a bank, police, courier, telecom, or platform.
license: MIT
---

# Scam Mirror

Scam Mirror releases two short-lived CALL-E "flies" for a user-initiated
anti-fraud check:

- **Fly-A (official)** dials the published official hotline for the claimed
  organization and asks whether a "callback / case / freeze" flow actually
  exists for the suspect number.
- **Fly-B (suspect)** dials the suspect number and records red flags such as
  requests for codes, transfers, remote control, crypto, or secrecy.

The two summaries are compared and a JSON attestation is emitted with
`likely_legit | likely_scam | inconclusive`, confidence, signals, and evidence
hashes. No user identity is collected, and full recordings are not stored.

## When To Use

- A user received a suspicious callback or caller-ID claim and wants to verify it.
- A user wants an evidence-backed answer before complying with a "your account
  is compromised, call back" instruction.

## When Not To Use

- Do not use for cold outreach, mass dialing, or untargeted number scanning.
- Do not use to collect personal data, IDs, bank cards, or verification codes.
- Do not treat the output as a legal or authoritative conclusion; it is advisory.

## Workflow

1. Confirm the user explicitly wants a verification call.
2. Collect the suspect number (E.164), the claimed organization, and optionally
   the region and script details.
3. Resolve the official number from `orgs.whitelist.json`, or accept an explicit
   override.
4. Run Fly-A and Fly-B. Both carry a TTL, max duration, and a kill switch: any
   request for a code, password, transfer, remote control, crypto, or secrecy
   ends the call immediately.
5. Compare and judge with the rule engine (LLM comparison optional).
6. Emit the attestation and write it to `results/`.

Dry-run is the default and never dials. Use `--live` only for a verification the
user personally initiated.

```text
resolve official -> Fly-A (official) + Fly-B (suspect) -> compare -> attestation
```

## Run

```bash
python3 scripts/run_dual_fly.py \
  --number "+1 555 010 0100" \
  --org "Example Bank"
```

Read `references/examples.md` for dry-run and live examples, and
`references/safety.md` for the full safety contract.

