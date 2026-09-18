# Judge demo script — Call Aunty × CALL-E (V5)

**Duration:** ~4 minutes · **Mode:** DEMO (fail-closed, no carrier dial)

## 1. Problem (30s)

Community health workers need to close the loop after check-ins. Phone follow-up is slow, easy to lose offline, and risky without consent and policy gates.

## 2. Open record (30s)

- Bangla-first UI for the CHW
- Show woman record with referral banner
- Point out: **UI language ≠ call language** (English US for CALL-E demo)

## 3. Pre-call review (45s)

- Tap **Start phone follow-up**
- Sheet shows: DEMO indicator, consent attestation, purpose, synthetic demo number
- Emphasize: prepare shows side effects before any call

## 4. Prepare + confirm (60s)

- **Prepare dry-run** → masked recipient, policy `dry_run`
- **Confirm** → status `dry_run_completed`
- Follow-up outcome mapped locally + sync queue

## 5. Command center (45s)

- **Open call command center**
- Filter by status; tap call → detail panel
- Show: correlation ID, event timeline, AI confidence gate, structured outcome

## 6. Hero demo button (30s, optional)

- Tap **Run hero demo** — one-click synthetic beneficiary (`demo-ben-001`)
- Same pipeline, deterministic for judges

## 7. Safety close (30s)

- Server-only API key
- Urgent triage denies automated call
- Kill switch + demo mode fail-closed
- Reusable contribution in `contrib/awesome-phone-call-agents/`

## Talking points for judges

- Real CALL-E adapter path exists (`@call-e/calle` ^0.7.0) behind server policy
- Demo spectacular without phone credits; live opt-in only
- AI bounded: schema validation, confidence gates, no chain-of-thought
