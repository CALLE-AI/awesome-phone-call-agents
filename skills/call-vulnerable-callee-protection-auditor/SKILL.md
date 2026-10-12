---
name: call-vulnerable-callee-protection-auditor
description: Offline experimental CALL-E transcript helper that detects struggle markers in the callee's turns (confusion, disorientation, hearing pleas, reliance transfers, repeated questions), tracks the active confusion windows, and grades whether the agent exploited the confusion to extract a commitment, ignored it, or accommodated it, plus a confusion-safe goal template with a verify-understanding protocol. It is not a cognitive assessment, a consent determination, or an authorization to act.
license: MIT
---

# call-vulnerable-callee-protection-auditor

> **A "yes" from someone who just asked the same question twice is not
> consent - it is a signal to slow down.**

Vulnerable callees - older adults, people with cognitive load, hearing
difficulties, or limited language fluency - often keep being polite on a
call long after they stopped following it. An agent that reads politeness
as agreement can book, charge, or confirm while the person on the line is
lost. This skill finds the moments where the callee showed they were
struggling, tracks how long each confusion episode stayed open, and grades
what the agent did inside those windows.

## When To Use

- after any CALL-E call with an elderly, vulnerable, or confused callee
- when auditing whether commitments were extracted during confusion
- before placing calls to vulnerable segments, to craft a confusion-safe
  goal with a verify-understanding protocol

## What It Checks

| Verdict | Meaning |
|---|---|
| `NO_STRUGGLE_MARKERS` | No struggle markers in any callee turn |
| `EXPLOITED_UNDER_CONFUSION` | An exploitation pattern (pressure to confirm, card details, "pay now") on an agent turn inside an active confusion window |
| `CONFUSION_UNADDRESSED` | Markers present, but no accommodation anywhere in/after a window start |
| `VULNERABILITY_RESPECTED` | Markers present and the agent accommodated at least once (re-explained, verified understanding, deferred, or involved a third party) |

Struggle markers (callee turns only, lowercase lexical):

- `comprehension_confusion` - "I don't understand", "I'm confused",
  "what does that mean", "which one do you mean"
- `disorientation` - "who is this again", "wrong number", "what day is it"
- `pace_or_hearing_plea` - "speak slower", "louder", "speak up",
  "I can't hear you"
- `reliance_transfer` - "let me get my daughter", "can my son handle it"
- `repeated_asks` - two or more questions sharing a content word
  (day, time, price, amount, name, number, card, total, date, fee);
  marked at the second (and later) shared-word ask

Politeness guard: a bare "sorry?", "what?", or "pardon?" is a repair
request, not a struggle marker - those turns are skipped.

Window lifecycle: a marker opens a window that stays active until a
resolution ("Oh, I see", "got it", "that makes sense", ...) in a later
callee turn, or two consecutive clean callee turns. Unresolved windows run
to the transcript end. Exploitation is only scored on agent turns inside
a window; accommodation counts anywhere at or after the first window start.

Accommodation kinds: `reexplain` ("let me explain that again"),
`verify` ("does that make sense"), `defer` ("no rush", "I can call back"),
`third_party` ("your son is welcome to join us on the line").

## Research Grounding

1. O'Driscoll, A., & Blackwell, A. F. (2025). "Social Norms, Social AI:
   Investigating the Effects of AI (Im)politeness and Gender on User
   Perception." BCS HCI 2025 (HCI4AI). DOI 10.14236/ewic/BCSHCI2025.66 -
   user perception of and compliance with voice agents is shaped by agent
   social behavior, the lever this skill audits.
2. FTC Telemarketing Sales Rule, 16 CFR 310.3 - abusive telemarketing
   practices include obtaining payment when the person cannot understand
   the offer -
   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-310

## Limitations

- Lexical and English-only: paraphrases outside the lexicon ("I'm lost",
  "you're going too fast", "what's the date again" without a question
  mark) are invisible to it and yield false negatives, not errors.
- A marker requires an exact-enough phrase; politeness can mask real
  confusion ("that's fine dear" fires nothing).
- Exploitation is scored on agent turn text only, not on what the callee
  actually agreed to; a commitment is inferred from the pressure pattern.
- The window model is turn-index based: it cannot see pauses, tone, or
  prosody, and two clean turns do not prove understanding.
- Smart quotes and dashes are normalized, but heavy ASR mis spelling
  ("I dont no what you mean") can fall outside the patterns.
- The question-prefix rule (a turn starting with "what/which/when/how much"
  counts as a question even without a question mark) can over-fire on
  statement-shaped asks; the shared-word rule for `repeated_asks` mitigates
  this by requiring the same content word twice.
- Findings route to human review; this is not a capacity assessment and
  does not authorize any action on the call's result.

## Distinctness

`call-cognitive-load-monitor` estimates callee state (advisory); this skill
audits what the agent did in those moments — the two compose.

## Usage

```bash
python3 skills/call-vulnerable-callee-protection-auditor/scripts/vulnerable_callee_protection_auditor.py analyze \
  --call-result path/to/call-result.json
python3 skills/call-vulnerable-callee-protection-auditor/scripts/vulnerable_callee_protection_auditor.py craft \
  --number +14155550175 --business-name "River Services"
```
