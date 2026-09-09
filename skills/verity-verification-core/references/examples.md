# Examples

Three headline cases, each runnable with no network:

```bash
python scripts/reconcile_call.py --call assets/experience-a.call.json --input assets/experience-a.input.json
python scripts/reconcile_call.py --call assets/experience-b.call.json --input assets/experience-b.input.json
python scripts/reconcile_call.py --call assets/experience-d.call.json --input assets/experience-d.input.json
python scripts/self_test.py    # runs all three, asserts each verdict
```

All numbers below are fictional. The call snapshots are synthetic `CallTask` payloads.

---

## Experience A — clean confirm -> ALLOW

**Intent:** `confirm` the customer's existing haircut on 2026-09-08 at 09:00
America/New_York.

**Transcript (abridged):**

```
bot : I have you down for Tuesday, September 8th at 9:00 AM. Does that time work?
user: Yes, 9 works, see you then.
```

**CALL-E claim:** `task_completed: true`, confidence `high`.

**What the gate does:**

- Grammar resolves the caller's turn to `2026-09-08 09:00` — the bot restated the full
  date and time immediately before, and the caller affirmed it, so
  `explicit_confirmation = true` (E4).
- Parsed value **exactly equals** the value the write would make (E3).
- No ambiguity flags (E5). The resource re-check you supply is still yours (E6). No
  learned pattern fires (E7).
- E1 (`task_completed == true`, confidence not low) holds — necessary, and here the
  rest hold too.

**Verdict:** `ALLOW  reason=allow_clean`. Your integration commits the confirmation and
records that it came from the call transcript.

---

## Experience B — caller self-corrects, CALL-E still says done -> BLOCK, ghost booking prevented

**Intent:** `reschedule` to 2026-09-10. The task was planned for **15:00**; the caller
changes their mind on the call.

**Transcript (abridged):**

```
bot : Okay, Thursday. And what time?
user: Thursday at 3... no wait, make it 3:30.
bot : Alright, I've noted that down.
```

**CALL-E claim:** `task_completed: true`, confidence `high`, and CALL-E's own extracted
`structured_result.time` is **15:00** — the value the caller *retracted*.

**What the gate does:**

- Grammar finds two candidate times in one caller turn (`15:00`, then `15:30`) with a
  `no wait` correction cue between them. The post-correction value wins:
  `resolved_targets = [15:30]`. There is no later re-confirmation, so
  `explicit_confirmation = false`.
- `detect()` raises `self_correction_unresolved` (a correction with no re-confirmation)
  and `claim_parse_mismatch` (parsed `15:30` != the planned `15:00`).
- Ordered BLOCK checks: `self_correction` fires first (row 8). Because
  `task_completed == true` **and** the parsed value differs from what the action would
  write, `ghost_booking_prevented = true` — a wrong calendar entry (15:00) was caught
  first-hand, not written.

**Verdict:** `BLOCK  reason=self_correction  (ghost booking prevented)`,
`repair_target = 2026-09-10 15:30`. Your integration opens a second channel quoting
**3:30** (the corrected value, not CALL-E's 3:00): *"We heard haircut on Thursday,
September 10 at 3:30 PM. Reply YES to confirm or NO to change."* A `YES` commits to
15:30; anything else goes to a human.

---

## Experience C — a learned pattern auto-routes an unseen call to the second channel

Experience B, once its corrected value was confirmed by the customer, can be saved as a
**PII-safe pattern** for your own learned-pattern store, using `normalizePattern` /
`skeleton` / `assertPatternPiiClean` from the TypeScript core:

```
<TIME> ... "no wait" ... <TIME>          (no name, no number, no calendar date)
```

A later, differently-worded call — *"Let's do four o'clock... actually four thirty is
better."* — has never been seen before, but its skeleton (`<TIME> <CORRECTION> <TIME>`)
matches the saved pattern. You pass the matched fixture id into `decide()` via
`matched_fixtures: [{ fixture_id, expected_behavior: "force_sms_confirmation" }]`:

- E7 fails, so the gate returns `BLOCK  reason=fixture_force_sms` **before** it even
  weighs the transcript — no human had to flag this call.
- `repair_target` is the parsed post-correction value (`16:30`), and the same
  second-channel confirmation runs. No `operator_adjudicated` step anywhere.

The failure the system caught once, it now catches on its own. This skill supplies the
gate decision and the PII-safe normaliser; the fixture store and the matcher are yours.

---

## The adversarial case (D) — a clean-looking claim with no confirming turn -> BLOCK

**Intent:** `book` on 2026-09-09 at 11:00.

**Transcript (abridged):**

```
user: Is 11 or 11:30 open?
bot : Both are open.
user: Let's say 11.
bot : Okay, thanks, bye.
```

**CALL-E claim:** `task_completed: true`, confidence `high`, `structured_result.time`
`11:00` (non-null).

The interrogative turn ("Is 11 or 11:30 open?") contributes mentions, not a target. The
declarative "Let's say 11." resolves `11:00`, which *matches* the intended value — but
**no bot turn restated the full value and got an affirmative**, so
`explicit_confirmation = false` and `detect()` raises `no_explicit_confirmation`.

**Verdict:** `BLOCK  reason=no_explicit_confirmation`, `repair_target = 2026-09-09
11:00`. Even a value that is *correct* is not written until someone confirms it. This is
the case that separates "the caller agreed" from "a value was mentioned".
