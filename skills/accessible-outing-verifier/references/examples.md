# Examples: Accessible Outing Verifier

The examples below demonstrate the deterministic safety evaluation produced by `scripts/verify-outing.mjs` in offline dry-run mode using the fictional test phone number `+15555550199`.

---

## Example 1: The Hero Demotion (Qualified Staff Response)

When staff provides an ambiguous or hedged response (*"I think it should be working..."*), the safety firewall intercepts the extraction and demotes the status to `UNKNOWN`.

```bash
node scripts/verify-outing.mjs --profile assets/sample-outing-request.json
```

```text
============================================================
       CALL-E SKILL: ACCESSIBLE OUTING VERIFIER
============================================================
Target Venue: The Grand Theater
Phone:        +1-555-***-0199
Persona:      Power Wheelchair User
Mode:         OFFLINE DRY-RUN (Default)

[Phase 1] Digital Gap Triage:
  [PASS] Step-Free Main Entrance (Verified via OpenStreetMap Nominatim)
  [GAP]  Main Elevator Operating Today (CRITICAL OPERATIONAL GAP)

[Phase 2] CALL-E Bounded Actuation (1 gaps to verify):
  Task: Dial venue contact to verify operational accessibility.
  Human Consent Gate: Authorized.

[Phase 3] Deterministic Safety Firewall:
  Raw Telephony Output: "qualified_confirmation"
  Staff Quote:          "I think it should be working, but maintenance has not signed off yet today."
  -> FIREWALL TRIGGER: "qualified_confirmation" detected.
  -> ACTION: Demoting constraint strictly to UNKNOWN.
  -> RATIONALE: Hedged claims must never authorize physical safety.

============================================================
                  FEASIBILITY BRIEF
============================================================
Overall Outing Verdict: NOT FULLY VERIFIED (SAFETY DEMOTION)
Recommendation: Do not dispatch user without on-site backup plan.
============================================================
```

---

## Example 2: Hard Physical Barrier

When staff confirms a physical barrier that cannot accommodate the patron's requirements (e.g. 42 steps and no lift).

```text
============================================================
Target Venue: The Rooftop Lounge
Phone:        +1-555-***-0199
Verdict:      NOT FEASIBLE (HARD PHYSICAL BARRIER)
Finding:      Staff Quote: "This is a historic landmark; guests must climb 42 stone steps. No elevator."
Status:       FAILED (Entrance/Lift Refuted)
============================================================
```

---

## Example 3: Full Confirmation

When staff unequivocally confirms all critical operational requirements.

```text
============================================================
Target Venue: Metropolitan Symphony Hall
Phone:        +1-555-***-0199
Verdict:      FEASIBLE (100% OPERATIONAL CERTAINTY)
Finding:      Staff Quote: "Yes, both elevator banks A and B are active with no interruptions."
Status:       PASSED
============================================================
```
