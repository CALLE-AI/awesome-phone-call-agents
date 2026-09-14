# Examples: Accessible Outing Verifier

The examples below demonstrate the deterministic safety evaluation produced by `scripts/verify-outing.mjs` in offline dry-run mode using the fictional test phone number `+15555550199`.

---

## Example 1: The Hero Demotion (Qualified Staff Response)

The fixed synthetic response is labeled `qualified_confirmation` and the helper demonstrates demoting that label to `UNKNOWN`; it is not interpreting a real conversation.

```bash
node scripts/verify-outing.mjs --profile assets/sample-outing-request.json
```

```text
============================================================
       CALL-E SKILL: ACCESSIBLE OUTING VERIFIER
============================================================
Target Venue: The Grand Theater
Phone:        ***0199
Persona:      Power Wheelchair User
Mode:         OFFLINE DRY-RUN (Default)

[Phase 1] Digital Gap Triage:
  [FIXTURE] Step-Free Main Entrance (Supplied source label: OpenStreetMap Nominatim)
  [GAP]  Main Elevator Operating Today (CRITICAL OPERATIONAL GAP)

[Phase 2] CALL-E Bounded Actuation (1 gaps to verify):
  Task: Simulate an accessibility verification question; no call is placed.
  Human Consent Gate: Simulated only; no live authorization was obtained.

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

## Example 2: Proposed Hard-Barrier Interpretation

This is an illustrative interpretation, not another scenario implemented by the runner. Any real staff statement would require human verification.

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

## Example 3: Proposed Confirmation Interpretation

This illustration is advisory, not an implemented runner scenario or proof of safe access. Verify critical conditions with the venue before acting.

```text
============================================================
Target Venue: Metropolitan Symphony Hall
Phone:        +1-555-***-0199
Verdict:      ADVISORY CONFIRMATION — HUMAN VERIFICATION REQUIRED
Finding:      Staff Quote: "Yes, both elevator banks A and B are active with no interruptions."
Status:       PASSED
============================================================
```
