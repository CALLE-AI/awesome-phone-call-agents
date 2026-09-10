# Safety design

A welfare call is not a restaurant booking. The failure that matters is not a rude
call — it is a call that produces a clean-looking "this person is fine" when nobody
actually confirmed it, because that removes the household from the follow-up list.

**Two kinds of control, and they are not the same guarantee.**

A prompt constraint is an instruction we can prove we sent.
A code gate is a branch the model cannot route around.
Only the second is a guarantee. This file keeps them apart on purpose.

## Code gates — enforced outside the model

| Behaviour | Where |
|---|---|
| Consent-first: no preview, no dial | `scripts/engine.py` `run()` |
| Dry-run default; live needs `mode="live"` **and** `human_confirmed=True` | `engine.run()` |
| Fail-closed: any unrecognised adapter status becomes `halted_safe` | `engine.run()` |
| Confidence gate: `< 0.6` emits `structured_result=None` and `needs_human=True` | `engine.run()` |
| A refusal is not evidence: `declined` is its own terminal code, no content evidence | `engine._result()` |
| `wrong_person` and `voicemail` are distinct terminal codes, not "failed" | `engine.run()` |
| Bounded handoff: only allowlisted fields cross to the human | `engine._result()` |
| Offline containment: `RealAdapter` refuses without an API key **and** an explicit env gate | `scripts/adapters.py` |
| Unknown equipment / unknown battery rank as most urgent, not least | `scripts/triage.py` |
| The recipient is passed to CALL-E as the call destination | `adapters.py` `RealAdapter.dial()` |
| Live destinations must be strict ASCII E.164 **and** on `PB_ALLOWED_DESTINATIONS`; empty list authorises nothing, and there is no wildcard | `adapters.py` `authorise_destination()` |
| Keyword-derived welfare summaries are advisory: `advisory_needs_review`, `needs_human=True`, never dispatched | `engine.py` `run()` |
| Every result records where its assessment came from (`assessment_basis`) | `engine.py` `_result()` |

## Prompt constraints — deterministically built, but obeyed rather than enforced

| Behaviour | What is actually guaranteed |
|---|---|
| AI self-disclosure is the first sentence | The code **always prepends** it to the task text. We can prove what we sent. We cannot prove the model said it verbatim. |
| Disclosure allowlist | The code enumerates the permitted facts into the task and instructs the agent to refuse anything else. **This is an instruction, not a filter** — there is no post-hoc check on what was actually said. |

**What would close the gap**: a transcript-side check that flags any disclosed fact
outside the allowlist. **Not built.** Listing it here rather than claiming otherwise.

## Assessments: bound vs inferred

A structured result returned by the model is bound to the declared result schema, so
it may drive routing. A summary we derive ourselves from transcript keywords is not:
`"generator"` appearing in a sentence could be a question, a negation, or the caller's
own words. Those two are kept apart by `assessment_basis`, and only the first can
dispatch. The second is always routed to a human.

This is a code gate, not a convention — the branch is in `engine.run()`.

## Four gates before a real call

1. `mode="live"` — not the default
2. `human_confirmed=True` — an operator approved the preview
3. `PB_ALLOW_REAL_CALL=1` in the environment — plus `CALLE_API_KEY`
4. The destination is on `PB_ALLOWED_DESTINATIONS` — an explicit operator allowlist,
   fail-closed when unset, with no wildcard

Live calling is deliberately **not** a CLI flag. Placing a phone call to a stranger in a
disaster is not something a stray argument should be able to trigger.

## Data handling

- All shipped roster data is **synthetic**.
- `consent.build_preview()` masks the number before the preview is shown, logged, or
  screen-shared.
- Full transcripts are not retained by default; `evidence` holds only per-utterance
  summaries, and `declined` / `no_answer` produce none at all.
- `handoff_context` defaults to `["case_id", "scenario"]` — the minimum a human needs
  to pick the case up.

## What this skill will not do

Diagnose, advise medically, replace emergency services, call anyone who declined,
or keep questioning someone who asked for a human.
