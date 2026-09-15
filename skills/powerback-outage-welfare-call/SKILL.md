---
name: powerback-outage-welfare-call
description: Run a triaged batch of consent-first CALL-E welfare calls to households that depend on mains-powered life-support equipment during a power outage, ranking by equipment criticality and remaining battery, and returning a five-bucket board that separates "needs help" from "a human must follow up" instead of guessing.
license: MIT
---

# PowerBack Outage Welfare Call

Use this skill when an **emergency coordinator or district office** must find out, during
a power outage, **which households on life-support equipment are actually in trouble** —
and must do it faster than a person can work down a paper roster.

A map can show who is *at risk*. Only a call finds out who needs help *right now*.

The design premise: **being confidently wrong about whether someone is alive is worse
than admitting you do not know.** Every ambiguous outcome gets its own terminal state
and routes to a human, rather than becoming a clean-looking statistic.

## When to use

- An outage or disaster has hit a district with known electricity-dependent residents.
- You have a roster and need a **call order**, not just a call list.
- You need results as **actionable buckets** (dispatch / follow up / retry / safe / do-not-disturb).
- You want every call previewed and approved before it is placed.

## When not to use

- Medical triage, diagnosis, or anything that replaces emergency services.
- Unsolicited outreach, marketing, or lead generation.
- Recurring schedules — pair with a scheduler wrapper and re-confirm consent.
- Any context where a wrong answer would remove someone from a follow-up list without
  a human ever seeing the case.

## Workflow

1. Read `references/safety.md`. It separates **code gates** from **prompt constraints** —
   they are not the same guarantee, and this skill does not pretend they are.
2. Build the roster. Each entry validates against `references/call_input.schema.json`:
   E.164 `phone`, `scenario`, `language`, and a `disclosure_allowlist`.
3. **Rank**: `python run_batch.py` — call order only, nothing dialled.
4. **Preview**: `python run_batch.py --show-preview` — shows the operator exactly what the
   agent will be told to say, with the number masked.
5. **Simulate**: `python run_batch.py --simulate` — full loop against `FakeAdapter`,
   entirely offline, prints the triage board.
6. **Live**: set `CALLE_API_KEY` and `PB_ALLOW_REAL_CALL=1`, and call
   `engine.run(..., mode="live", human_confirmed=True)`. Three separate gates, on purpose.
   Live calling is **not** exposed as a CLI flag.

## Ranking

`priority_score = equipment_weight x 10 + battery_urgency`

Ventilator and **unknown** both weigh 3.0 — if the equipment type is not recorded, the
case is treated as the most critical, not the least. An unrecorded battery level is
treated as zero hours remaining. Both are fail-closed by design.

## Output

`run_batch` returns `{"order": [...], "board": {...}, "results": [...]}`. The board has
five buckets, and the split is the product:

| Bucket | What lands there |
|---|---|
| `needs_help` | Answered and asked for something — dispatch |
| `human_followup` | Thin data, wrong person, or fail-closed — a person must call |
| `retry_queue` | No answer, voicemail |
| `confirmed_safe` | Answered, needs nothing |
| `do_not_disturb` | **Declined.** Never counted as evidence of anything |

Per-call results validate against `references/call_result.schema.json`.

## Files

```
powerback-outage-welfare-call/
├── SKILL.md
├── run_batch.py                    CLI: rank / preview / simulate
├── references/
│   ├── safety.md                   code gates vs prompt constraints
│   ├── call_input.schema.json
│   └── call_result.schema.json
├── scripts/
│   ├── engine.py                   validation, gates, result shaping
│   ├── consent.py                  disclosure opening + disclosure budget
│   ├── triage.py                   ranking + batch loop + board
│   └── adapters.py                 FakeAdapter (offline) / RealAdapter (gated)
└── assets/
    └── synthetic_roster.json       8 synthetic cases, no real data
```

## Honest limits

- **Every record shipped here is synthetic.** No real personal data was used.
- The disclosure opening and the allowlist are **prompt constraints**: the code always
  builds them into the task text, but there is no output-side filter. Closing that
  properly needs a transcript check, which is not built.
- `FakeAdapter` coverage is a test of the state machine, **not** of real-world call
  reliability.
- Full transcripts are not retained by default.
- The CALL-E Taiwan line was English-only when checked (2026-09-02), which excludes
  Taiwanese-speaking elderly residents — arguably the core user. Stated rather than
  designed around.

Mask phone numbers in any user-facing summary. `consent.build_preview()` already does.
