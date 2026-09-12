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
