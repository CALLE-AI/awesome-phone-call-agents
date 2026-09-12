# Examples

These examples illustrate the three core audit outcomes of `chrono-audit`.

## Example 1: Contradicted Verbal Claim (Merge Blocked)

### PR Input
- **Title**: Drop legacy v1_accounts table
- **PR Body**: As confirmed with @sarah_dba during standup, this is safe to drop the legacy table.

### Telephony Verification Trace
- **Authorizer**: `@sarah_dba` (`+15550192481`)
- **Interrogation Method**: Open recall first
- **Received Statement**: *"No — we actually agreed to keep v1_accounts for backward compatibility until the Q3 migration finishes."*
- **Direct Confirmation**: `denied`
- **Entailment**: `neutral` / `contradiction`

### Verdict
- **Status**: `BLOCKED`
- **CI Gate**: Merge blocked; commit status check failed; PR audit comment posted.

---

## Example 2: Multi-Hop Delegation Chain (Merge Verified)

### PR Input
- **Title**: Change access pattern for token routing
- **PR Body**: The architect verbally cleared this breaking schema change during today's standup, so merging this once CI is green.

### Telephony Verification Trace
- **Hop 0**:
  - **Authorizer**: `The architect` (`+15550148392`)
  - **Statement**: *"Yes, I verbally cleared this breaking schema change this morning — the security lead had already signed off on the access-pattern change last week, so I gave the go-ahead."*
  - **Direct Confirmation**: `confirmed`
  - **Chained Entity Discovered**: `the security lead`
- **Hop 1**:
  - **Authorizer**: `the security lead` (`+15550173921`)
  - **Statement**: *"Yes, that's right — I already signed off on the access-pattern change last week after reviewing it, so it's confirmed on my end."*
  - **Direct Confirmation**: `confirmed`
  - **Entailment Score**: `0.85` (Entailment)

### Verdict
- **Status**: `VERIFIED`
- **CI Gate**: All hops resolved and confirmed; safe to merge.

---

## Example 3: Unregistered Contact (Human Review Escalation)

### PR Input
- **Title**: Rotate token signing key
- **PR Body**: Confirmed with Random Person that rotating the signing key today is fine.

### Verification Trace
- **Authorizer**: `Random Person`
- **Directory Lookup**: Not found in verified organization phonebook.
- **Telephony Action**: Call aborted (anti-spoofing policy forbids dialing unverified numbers).

### Verdict
- **Status**: `NEEDS_HUMAN_REVIEW`
- **CI Gate**: Escalated to repository maintainers for manual intervention.

---

## Example 4: Agent CLI Privilege Escalation (`telephony-sudo`)

Autonomous coding agents (e.g. Claude Code, Devin) executing commands with high blast radius are intercepted in real-time.

### Terminal Interception
```bash
python scripts/telephony_sudo.py \
  --cmd "DROP DATABASE prod_accounts;" \
  --authorizer "@sarah_dba" \
  --reason "DB migration cleanup"
```

### Trace & Enforcement
- Process execution immediately suspended (SIGSTOP / freeze).
- CALL-E dials `@sarah_dba`'s verified phone number with dynamic liveness challenge nonce.
- Authorizer denies authorization verbally.
- `telephony-sudo` unfreezes and issues `SIGKILL` (Exit Code 1) terminating destructive command.

---

## Example 5: Cryptographic Voice Provenance (`git voice-blame`)

Inspect historical commits or file lines to verify voice clearances and cryptographic HMAC-SHA256 signatures.

### Inspection Command
```bash
python scripts/git_voice_blame.py --commit 3d8a11b90c
```

### Provenance Output
```text
=== CHRONO-AUDIT: Git Voice Blame Provenance ===
Commit: 3d8a11b90c
Author: Autonomous SWE Agent <agent@example.net>
Subject: Change access pattern for regional shard token routing

[VOICE ATTESTATION DETECTED]
Attestation ID  : attest_3d8a11b90c
Authorizer      : The architect (+1 206 555 0148)
Signature       : HMAC-SHA256:d8f72a19c43b0e1e...
Status          : VALID (Untampered)
Recording Hash  : sha256:4a5de800fd2ff808cacda22ddb0fce48514953c...
Stored Ref      : refs/notes/chrono-audit
================================================
```

