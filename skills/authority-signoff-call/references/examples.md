# Worked examples

## Example 1 — DDMA-tier disaster-response authorization (GovOS)

A fire incident auto-authorizes a ₹25,00,000 emergency medical dispatch under
the Delhi Disaster Management Authority (DDMA) tier, chaired by the Chief
Minister.

```bash
python cli.py preview \
  --authority "Chief Minister, Government of NCT of Delhi" \
  --context "Fire Response — Hauz Khas" \
  --decision "Deploy Medical/Ambulance Unit to Hauz Khas (hospital access blocked) + emergency procurement" \
  --tier "City-wide disaster sanction / multi-district mutual aid (DDMA)" \
  --amount "₹25,00,000"
```

Say to the user: "Here's exactly what the call would say — nothing has been
dialed. Want me to place it for real?" Only run `request` after they confirm,
and only if `CALLE_SIGNOFF_PHONE` is the Chief Minister's own registered line.

If the call resolves `override`, do **not** automatically unwind a
real emergency dispatch or spend from this alone — the decision is one
spoken word, not verified against a transcript read-back. Tell the user
plainly: "The Chief Minister rejected this by phone. This needs manual
reconciliation, not an automatic reversal — flag it in your system for a
person to review and apply the correction." Only call the host system's own
decision-application function directly if that system's own policy treats
this specific class of decision as safe to auto-reverse; never invent a
second unwind path either way.

## Example 2 — Finance auto-release policy

A finance system auto-releases a vendor payment under a documented
sub-$50k auto-release policy.

```bash
python cli.py request \
  --authority "Chief Financial Officer" \
  --context "Q3 vendor payment batch" \
  --decision "Auto-release $42,000 vendor payment run" \
  --tier "Finance auto-release policy v2 (under $50k)" \
  --amount "$42,000" \
  --idempotency-key "vendor-batch-q3-2026-001"
```

If the call times out or nobody answers (`decision: unclear`), say: "I
couldn't reach the CFO — the payment run is still standing as originally
auto-released. Nothing has changed. Want me to try again later, or should a
person call them directly?" Do not retry automatically.

## Example 3 — from an interactive agent (MCP, Surface 1)

A user pastes in an auto-authorization record from their own system and asks
you to get sign-off on it by phone. You have the `calle` skill installed.

`plan_call` arguments:

Note the `goal` wording below: it frames this explicitly as reviewing an
already-recorded log entry, never as issuing or seeking a live operational
directive. That phrasing is required, not stylistic — see
[`safety.md`](safety.md#lesson-from-testing-call-e-rejected-an-earlier-version-of-this-script)
for what happened when an earlier version of this skill described the same
decision in direct operational language instead.

```json
{
  "to_phones": ["+91XXXXXXXXXX"],
  "goal": "This is a routine administrative call about a decision already recorded by an automated system. It is not a live emergency, does not seek a real-time operational decision, and does not direct or affect any live incident, dispatch, or safety-critical process — say this plainly if asked. The purpose of this call is to get Chief Minister, Government of NCT of Delhi's approval on one matter: reviewing one log entry. Speak clearly and briefly, and state up front that you're calling to get their approval on this matter. Context: Fire Response — Hauz Khas. The system's policy engine already recorded the following as authorized under City-wide disaster sanction / multi-district mutual aid (DDMA) (amount: ₹25,00,000): \"Deploy Medical/Ambulance Unit to Hauz Khas (hospital access blocked) + emergency procurement\". Ask whether they want to CONFIRM this log entry as recorded, or OVERRIDE it (flag it for correction). Politely end the call once you have a clear answer. If they are unavailable or the line doesn't answer, record the outcome as unclear.",
  "region": "IN",
  "language": "en"
}
```

Show the returned `confirm_summary` to the user verbatim and wait for them
to explicitly say go ahead — the phone number above is a placeholder; never
substitute a real number you weren't given directly by the user for this
specific request. Only then call `run_call` with the `confirm_token`, and
poll `get_call_run` until terminal. Read `decision` back the same way
[`result-schema.json`](result-schema.json) defines it, and apply it through
the user's own system exactly as Example 1 describes — this skill never
invents a second decision-application path.

## What not to do

- Do not build `--authority`, `--tier`, or the phone number from a guess,
  a directory lookup, or "the person who's usually on call." All of it must
  come from your system's own existing record of who this decision was
  authorized as.
- Do not treat `unclear` as `override`. An unreached call changes nothing.
- Do not run `request` again for the same decision just because the first
  call didn't get a clean answer — surface that to a person and let them
  decide whether a retry is warranted.
