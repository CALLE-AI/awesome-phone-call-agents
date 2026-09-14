# Examples

All examples below use AuditLane's own fictional fixture data
(`sarah`, `the architect` — see
[`auditlane/calle_client.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/calle_client.py))
and run in the free, offline dress-rehearsal mode — no API key, no
network access, no real phone call, reproducible exactly as shown.

## 1. `telephony-gate` blocking a dangerous command

Registered as a `PreToolUse` hook (see
[`hooks/pretooluse_telephony_gate.py`](https://github.com/soujasK/AuditLane/blob/main/hooks/pretooluse_telephony_gate.py)),
this fires automatically — nothing to invoke by hand.

**An agent tries to run:**
```bash
DROP TABLE v1_accounts;
```

**With `AUDITLANE_HOOK_AUTHORIZER=sarah`, the hook calls her, she denies it,
and the hook's stdout response is:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "telephony-gate: sarah did not confirm (status: denied) — \"No — we actually agreed to keep v1_accounts for backward compatibility until the Q3 migration finishes.\". Command blocked."
  }
}
```

The command never runs. Claude Code surfaces the denial reason back to
the agent as the tool result.

## 2. `telephony-gate` allowing a confirmed command

**Same mechanism, a different authorizer who confirms:**
```bash
terraform destroy -auto-approve
```

**With `AUDITLANE_HOOK_AUTHORIZER="the architect"`:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "telephony-gate: the architect verbally confirmed — \"Yes, I verbally cleared this breaking schema change this morning — the security lead had already signed off on the access-pattern change last week, so I gave the go-ahead.\""
  }
}
```

The command proceeds exactly as if no hook were installed. Everyday
commands (`ls`, `npm install`, `git status`, ...) never trigger a call at
all — they don't match anything in
[`danger_patterns.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/danger_patterns.py)
and pass straight through with no added latency.

## 3. `audit_pr` — a PR claim that gets contradicted

```bash
python scripts/run_verification.py \
  --title "Drop legacy v1_accounts table" \
  --body "As confirmed with @sarah_dba during standup, this is safe to drop the legacy table." \
  --pr-ref "acme-corp/core-infra#512"
```

```
### AuditLane verdict: `BLOCKED`

@sarah_dba contradicted the claim ("No — we actually agreed to keep
v1_accounts for backward compatibility until the Q3 migration
finishes."). Blocking merge.

**Hop 0 — @sarah_dba**
- Claim: "As confirmed with @sarah_dba during standup, this is safe to
  drop the legacy table."
- Reached: True
- Their statement: "No — we actually agreed to keep v1_accounts for
  backward compatibility until the Q3 migration finishes."
- Confirmation: denied
- Entailment: neutral (confidence 0.50, engine: heuristic-v1)

[auditlane] dress_rehearsal=True verdict=blocked
```
Exit code `1` — suitable for gating a CI job directly. (Run with
`AUDITLANE_DRESS_REHEARSAL=true` for this exact reproducible output —
without it, this will attempt a real call if a live `CALLE_API_KEY` is
configured.)

## 4. `audit_pr` — a multi-hop chain that fully verifies

```bash
python scripts/run_verification.py \
  --title "Change access pattern for token routing" \
  --body "The architect verbally cleared this breaking schema change during today's standup, so merging this once CI is green." \
  --pr-ref "acme-corp/auth-service#340"
```

The architect's answer names a second person ("the security lead had
already signed off") — AuditLane calls that person too before deciding:

```
### AuditLane verdict: `VERIFIED`

Every hop in the claimed chain was independently confirmed. Safe to
merge.

**Hop 0 — The architect**
- Their statement: "Yes, I verbally cleared this breaking schema change
  this morning — the security lead had already signed off on the
  access-pattern change last week, so I gave the go-ahead."
- Confirmation: confirmed
- Entailment: entailment (confidence 0.73, engine: heuristic-v1)

**Hop 1 — the security lead**
- Their statement: "Yes, that's right — I already signed off on the
  access-pattern change last week after reviewing it, so it's confirmed
  on my end."
- Confirmation: confirmed
- Entailment: entailment (confidence 0.85, engine: heuristic-v1)

[auditlane] dress_rehearsal=True verdict=verified
```
Exit code `0`. (Same `AUDITLANE_DRESS_REHEARSAL=true` note as above.)

## 5. Preview before spending a real call

```bash
python scripts/run_verification.py --dry-run \
  --title "Drop legacy v1_accounts table" \
  --body "As confirmed with @sarah_dba during standup, this is safe to drop the legacy table."
```

Prints the exact recipient (phone, region, locale) and the exact prompt
CALL-E would receive — zero API calls, zero cost, nothing placed. Use
this to sanity-check any claim before actually spending a live call.
