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
| A live call needs a durable `PB_BATCH_ID`; without it no idempotency key can be built and the adapter refuses | `adapters.py` `RealAdapter.dial()` |
| The live request is pinned to `calle-ai==1.0.1` and asserted against its published signature offline | `scripts/check_sdk_contract.py` |
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
5. `PB_BATCH_ID` is set — a durable idempotency key, so a network retry cannot place
   a second call to the same household

## SDK contract

The live path targets **`calle-ai==1.0.1`** (`CALLE_SDK_VERSION` in `adapters.py`).
SDK 1.0 submits a single flat `phone` to `/v2/calls`, requires `idempotency_key` and
`result_schema`, and removed `structured_result`, the confidence score and the summary
fields. The result schema follows the `calle.result.scalar-object.v1` profile, so the
old `needs` array and the nullable battery field are expressed as booleans and an
optional number instead.

`python scripts/check_sdk_contract.py` binds the request against the published
signature offline — no key, no network, no SDK import, no call placed.

**What this does and does not establish.** It establishes that a live request would be
accepted by the SDK rather than raising `TypeError`. It does not establish that a call
succeeds, that the transcript is accurate, or that the provider behaves as documented.
**No live call has been placed from this skill.**

### Confidence is now self-reported

The `< 0.6` gate predates SDK 1.0, which removed the provider confidence score. The
result schema therefore asks the model for a `confidence_label`, and the adapter maps
high/medium/low onto a number for the existing gate.

That is **the model's own account of how sure it is** — a prompt-level signal, not a
measurement, and it belongs in the same category as the disclosure wording above.
`FakeAdapter` keeps a numeric confidence so the threshold branch stays exercised
offline. Closing this properly needs a provider-side signal that SDK 1.0 does not
expose.

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
