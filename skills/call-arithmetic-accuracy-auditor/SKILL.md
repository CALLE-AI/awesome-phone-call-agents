---
name: call-arithmetic-accuracy-auditor
description: Offline experimental transcript auditor that recomputes the arithmetic a CALL-E voice agent SPOKE (quantity-times-price totals, line-item sums, percent-off results, balance-due subtraction, clock durations) against the agent's own stated factors and grades ALL_COMPUTATIONS_CORRECT, ARITHMETIC_ERRORS_FOUND, UNVERIFIABLE_COMPUTATIONS_ONLY, or NO_SPOKEN_COMPUTATIONS, plus a factors-first goal crafter; not a pricing database, a billing system, or authorization to act.
license: MIT
---

# call-arithmetic-accuracy-auditor

> **A voice agent that states its factors out loud and then speaks a
> wrong total has committed the error in front of a customer. A human
> skimming the transcript hears a confident number - the audit has to
> redo the multiplication to catch it.**

Most QA measures whether a total was disclosed. Almost none measures
whether the total was arithmetically true given the numbers the agent
itself just spoke. This skill reads a finished call transcript,
recomputes every spoken computation from the agent's own stated factors,
and grades each one CORRECT, INCORRECT, or UNVERIFIABLE - then rolls the
sentence grades into one verdict a reviewer can act on.

## Why This Skill Exists

LLM arithmetic is not reliable enough to skip verification. Dziri et al.
("Faith and Fate", arXiv:2305.18654) show transformers solve
composition problems by pattern matching, not computation. Mirzadeh et
al. (GSM-Symbolic, arXiv:2410.05229) show accuracy degrades when only
the numbers change, so a clean-sounding factor sentence does not
guarantee a correct total. Wei et al. (arXiv:2505.15000) show spoken
math is worse still for cascade ASR+LLM pipelines - exactly CALL-E's
architecture. And the FTC's Policy Statement on Deception makes a wrong
spoken total a material misrepresentation to a consumer acting
reasonably. Verification therefore has to happen outside the model,
which is what this auditor is.

## When To Use

- after any CALL-E business call that quoted quantities, prices,
  percent-off results, balances, or durations
- before deploying a goal template whose task involves quoting totals,
  to establish an arithmetic QA baseline
- in CI over fixture corpora, to catch templates that produce fluent
  but wrong spoken totals
- alongside a disclosure checker: disclosure asks "was the total
  stated?"; this skill asks "was the stated total true?"

## Modes

### Analyze a finished call

```bash
python3 scripts/arithmetic_accuracy_auditor.py analyze \
  --call-result path/to/call-result.json
```

Accepts the real `get_call_run` result shape
(`{status, result: {transcript}}`), a bare `{transcript: [...]}` dict, or
a flat turn list. Emits the report described under Input/Output.

### Craft a factors-first goal

```bash
python3 scripts/arithmetic_accuracy_auditor.py craft --number +14155550135 \
  --business-name "Harbor Grill" --task "confirm the Friday reservation total"
```

`--number` must be a reserved test number matching
`+1[0-9]{3}55501[0-9]{2}`. Optional: `--language` (default `en-US`).
Emits a `goal_template` for plan_call whose `protocol` field instructs
the agent to state quantities and unit prices BEFORE any total, compute
the total before speaking it, read totals digit by digit, state line
items separately when unsure, and never round a total up.

## Verdicts

| Verdict | Trigger | review_action |
|---|---|---|
| `ARITHMETIC_ERRORS_FOUND` | at least one recomputed computation disagrees with the stated total (INCORRECT) | `recompute spoken totals in the goal template before deployment` |
| `ALL_COMPUTATIONS_CORRECT` | at least one computation detected, every one CORRECT | `none` |
| `UNVERIFIABLE_COMPUTATIONS_ONLY` | computations detected but none has all factors stated aloud (e.g. a bare total, a meridiem-less clock range) | `state the factors aloud before the total so arithmetic can be verified` |
| `NO_SPOKEN_COMPUTATIONS` | no computation pattern in any agent turn | `none` |

## Quick Start

Both commands run verbatim from the skill directory:

```bash
python3 scripts/arithmetic_accuracy_auditor.py craft --number +14155550135 \
  --business-name "Harbor Grill" --task "confirm the Friday reservation total"
```

```bash
python3 scripts/arithmetic_accuracy_auditor.py analyze \
  --call-result data/fixtures/demo-arith-001.json
```

The analyze command prints `verdict: ALL_COMPUTATIONS_CORRECT` for that
fixture - 3 nights x 120 = 360, then 360 + 45 = 405. Swap in
`demo-arith-002.json` and the same detector prints
`ARITHMETIC_ERRORS_FOUND` with delta 60 on the spoken multiply. Full
walkthroughs: [references/examples.md](references/examples.md).

## Input / Output

Input: a JSON file that is either the wrapped `get_call_run` shape

```json
{"status": "COMPLETED", "result": {"transcript": [{"role": "...", "text": "..."}]}}
```

or a bare dict with a `transcript` key, or a flat list of
`{"role", "text"}` turns (`speaker` is accepted as a role alias).
Agent-side roles: `agent`, `assistant`, `ai`, `bot`, `caller`. Callee
turns and `post_summary` are out of scope. Typographic quotes are
normalized before matching; digit runs of 7+ are masked in output.

Output report keys: `skill`, `mode`, `call_id` (masked), `verdict`,
`computations` (each with `turn_index`, `kind`, `sentence` (masked),
`factors`, `stated_result`, `computed_result`, `delta` (INCORRECT only),
`status`, `reason` (UNVERIFIABLE only)), `counts`
(`detected`/`correct`/`incorrect`/`unverifiable`), `review_action`.

Detected kinds: `multiply` (qty x unit price), `add` (line-item sums),
`percent_off`, `subtract` (balance due), `duration` (clock ranges),
`add_carry` (single fee-like operand continued from the prior stated
subtotal; guarded by a fee noun and an immediately preceding verifiable
computation),
`total_only` (a bare total with zero factor tokens; always UNVERIFIABLE).
CORRECT tolerance: |computed - stated| < 0.005.

## Limitations

- Multiply detection only fires for a whitelist of countable nouns
  (nights, rooms, tickets, seats, guests, hours, days, and similar).
  "5 parking spots at the mall and 25 total" deliberately does not
  fire - keeping the whitelist small trades recall for a low false
  positive rate.
- Quantities are digits only: "twenty nights" is not detected.
- Bare number tokens need at least 2 digits to count as amounts:
  single-digit bare numbers are treated as quantities.
- Analysis is sentence-scoped: factors in one sentence and the total in
  the next are not joined.
- Duration math is 12-hour only and requires meridiem markers on both
  times; otherwise it is UNVERIFIABLE (AMBIGUOUS_CLOCK).
- English only; heuristics, not a validated instrument.
- `post_summary` is out of scope: whether the summary faithfully
  reflects the transcript is the transcript-faithfulness auditor's
  territory; this skill audits arithmetic inside agent turns only.

## Differences from sibling skills

- `call-total-cost-disclosure-auditor` checks whether and when a total
  was disclosed; this skill checks whether the disclosed total is
  arithmetically correct.
- `call-transcript-faithfulness-auditor` asks whether a value is
  grounded in the transcript; this skill asks whether the stated
  factors arithmetically produce the stated result - a total can be
  fully grounded and still wrong.
- `call-certainty-calibrator` grades assertion confidence against goal
  facts; this skill grades arithmetic, independent of confidence.

## Research

Citations and the design decisions they drive:
[references/research-papers.md](references/research-papers.md).

## Testing

```bash
python3 -m pytest skills/call-arithmetic-accuracy-auditor/tests/ -v
python3 skills/call-arithmetic-accuracy-auditor/tests/test_arithmetic_accuracy_auditor.py
```

Both the pytest run and the standalone runner must pass with zero
failures.
