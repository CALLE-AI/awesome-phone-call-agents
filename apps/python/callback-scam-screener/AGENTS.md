# Agent Instructions

These instructions apply to the Callback Scam Screener app only
(`apps/python/callback-scam-screener/`). See the repository-root
[`AGENTS.md`](../../../AGENTS.md) for monorepo-wide conventions.

## Quick setup (safe, no credentials, no calls)

Run these in order from this directory — every one of them is side-effect-free:

```bash
uv sync --dev --extra gemini
uv run python screen.py --demo remote_access
uv run python screen.py --demo giftcard
uv run python screen.py --demo subtle
uv run python screen.py --demo legit
uv run pytest -q
```

`--demo` runs the real pipeline against four canned transcripts through a mock
CALL-E client — no account, no LLM key, nothing dialed. `pytest` does the same
with an injected mock client. This is enough to confirm the app installs and
the scoring pipeline behaves correctly without any credentials at all.

## Product boundary

This app screens a suspicious "call this number" claim from an email by
having CALL-E place a short, transparent call and scoring the transcript
against a fixed signal checklist (`signals.json`). It is a triage tool, not a
clearance tool — every verdict is meant for human review, not to silently
clear a number as safe. Do not add functionality that auto-clears,
auto-blocks, or takes an irreversible action on a verdict; see
`docs/CONCEPT.md` for why.

## Phone-call safety

- Never run `--live` unless the user has explicitly asked for a real call to
  a number they own or are authorized to call.
- `--live` always requires `--confirm`, a `--to-phone` that matches the
  number extracted from the email exactly in strict E.164 format, and either
  `--allow-number` or `--unrestricted` — do not add a path that bypasses any
  of these.
- Never guess, reformat, or "helpfully" normalize a phone number.
- Mask phone numbers in logs, examples, and test output (see
  `--show-full-number`'s default-off behavior) unless the user explicitly
  asks to see one in full.
- Do not commit real phone numbers, API keys, transcripts, or call
  recordings — an automated test already fails the build if a real-looking
  phone number appears in source.

## Source of truth

- `README.md` — setup, usage, exit codes, side effects, cancellation/rollback.
- `docs/CONCEPT.md` — design rationale and the Limitations section, including
  real test-harness results.
- `docs/AGENT_PROMPTS.md` — the Screener agent's actual production prompt and
  hard constraints.
- `signals.json` — the scoring checklist; the README's Signal checklist
  section is the human-readable mirror of it.

When implementation and documentation disagree, stop and resolve the
discrepancy rather than silently changing behavior.

## Change and validation discipline

- Before editing, run the Quick setup commands above to confirm the current
  baseline passes.
- Run `uv run pytest -q` after any change to `pipeline/` or `screen.py`.
- Do not describe a live CALL-E call as verified unless an authorized live
  run actually produced an inspectable transcript — a passing offline test or
  demo run is not the same claim.
