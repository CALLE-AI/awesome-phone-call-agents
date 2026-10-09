---
name: call-repair-sequence-auditor
description: Offline experimental CALL-E transcript helper that detects callee-initiated repair sequences (huh, can you repeat, did you say X), localizes and profiles the trouble-source agent turn, classifies how the agent handled each repair, and crafts chunked redial goals. It does not measure comprehension conclusively, calibrate a per-minute rate, or authorize another call.
license: MIT
---

# call-repair-sequence-auditor

> **"Sorry, what?" is data. An agent that plows past it manufactures a failed call.**

Conversation analysis calls it *other-initiated repair*: the moments one
speaker signals trouble in hearing or understanding. Human conversation
runs about one repair every 1.4 minutes across languages. A phone agent
that ignores a repair does not save time - it ends the call with a person
who never understood the ask, which is exactly how a "confirmed" outcome
turns out wrong later.

## When To Use

- after any CALL-E call where the callee asked to repeat, slow down, or
  confirm which value was meant
- to decide whether a follow-up call should use a chunked, slower goal
- to generate that goal for `plan_call` directly
- to profile which agent wording keeps causing the trouble (digit-dense,
  long sentences, long words)

## When Not To Use

- to detect sentiment or frustration; use `call-summarizer` or
  `call-semantic-barge-in-analyzer` for pacing and cooperation
- to repair an ambiguous email thread; that is `conversation-clarify`,
  which decides whether to call - this skill audits what happened in a
  call already made
- during a call; this is strictly post-call analysis plus pre-call goal
  crafting, because CALL-E exposes transcripts, not live audio
- as proof the person failed to understand; absent repairs can mean a
  clean call or an unengaged callee, and the card says so

## Workflow

### Audit a finished call

```bash
python3 scripts/repair_sequence_auditor.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `repair_events[]`: turn index, masked span, `repair_type`
  (`open_class` - "huh", "sorry?", "what?"; `repetition_request` -
  "can you repeat that"; `candidate_understanding` - "did you say X or Y";
  `partial_repeat` - quoting a fragment back with a question; 
  `specification_request` - "which one", "can you slow down"),
  `trouble_source_index` + `trouble_profile` (digit_dense, long_words,
  long_sentence), and `resolution` (`ADDRESSED` / `IGNORED` / `END_OF_CALL`)
- `repairs_initiated`, `unresolved_repairs`, `dominant_trouble_type`
- `comprehension_trouble`: LOW / MODERATE / HIGH (HIGH when 2+ repairs are
  ignored or 4+ repairs fire in one call)
- `recommended_action`: `continue`, `verify_understanding_prompt`, or
  `redial_with_simplified_goal` (with the goal text)

A repair is ADDRESSED when the next agent turn uses a re-delivery marker,
commits to one option, restates enough of the trouble source, or gives a
short digit-bearing restatement; a pivot to a new topic is IGNORED.

### Craft the follow-up goal

```bash
python3 scripts/repair_sequence_auditor.py craft --scenario high-trouble-redial
```

Emits the plan_call inputs JSON whose goal is the same chunked template the
card recommends: one fact per sentence, numbers digit by digit, explicit
permission to interrupt and ask for repeats.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Universal Principles in the Repair of Communication Problems (Dingemanse et al., PLoS ONE 10(9):e0136100, 2015) | The twelve-language CA study our taxonomy and the illustrative 1-repair-per-1.4-minutes baseline come from |
| An analysis of dialogue repair in virtual assistants (Galbraith, Frontiers in Robotics and AI 11:1356847, 2024) | Replicates the repair framework on Siri and Google Assistant; grounds applying CA repair categories to voice agents |
| You have interrupted me again!: making voice assistants more dementia-friendly with incremental clarification (Addlesee and Eshghi, Frontiers in Dementia, 2024, doi:10.3389/frdem.2024.1343052) | Grounds the craft mode: incremental clarification requests as the assistant-side answer to repair trouble |

Citation notes recorded during verification: the Dingemanse study is often
miscited to PNAS - it is PLoS ONE; the Addlesee paper is in Frontiers in
Dementia, not Frontiers in Computer Science. CALL-E exposes transcripts
without prosody or turn offsets, so this skill implements the lexical,
text-side approximation, reports counts instead of rates, and labels every
output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `conversation-clarify` detects ambiguity in written threads and decides
  whether one clarifying call is warranted; this skill audits repair
  inside a call that already happened and tunes the next one.
- `call-semantic-barge-in-analyzer` classifies how the callee's turns
  cooperate with pacing; this skill measures whether they understood at
  all, and whether the agent noticed.
- `call-review` checks disclosure and claim support; it does not count
  repair sequences or profile their causes.
