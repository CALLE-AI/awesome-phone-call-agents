---
name: call-temporal-anchor-auditor
description: Offline experimental CALL-E transcript helper that resolves every time reference in the agent's turns against the call timestamp, flagging relative-only commitments, meridiem-less clocks, dialect-dependent weekday phrases, and weekday-date calendar conflicts, plus an absolute-time goal template. It is not proof the callee misunderstood, a scheduler, or authorization to act.
license: MIT
---

# call-temporal-anchor-auditor

> **A promise with no calendar anchor is a no-show waiting to happen.**

CALL-E's highest-value calls are bookings: `appointment-confirm`,
`no-show-shield`, `slotsaver`, `capacity-backfill-cascade` all live or die
on whether the person on the other end walks in at the right slot. An agent
that closes with "see you tomorrow evening" or "your pickup is Tuesday at 2"
has exchanged a calendar anchor for a vibe - and each unanchored minute is
paid for later as a missed appointment, an idle bay, or a double-booked
table. This skill grades every time reference in the agent's own turns and
tells you which commitments would not survive a calendar check.

## When To Use

- after any booking, confirmation, or appointment call, ideally with
  `--called-at` set to the run's ISO-8601 start time so relative phrases
  ("tomorrow", "next month") resolve against a real reference date
- whenever the transcript shows commitments but you cannot say, from the
  text alone, which calendar day and clock time the agent actually locked in
- before placing the next wave of calls, to craft a plan_call goal that
  forces absolute-time discipline (weekday + date + clock + meridiem)

## When Not To Use

- without `--called-at` when the relative phrases matter: without a
  reference time they grade `unresolvable_without_call_time` and weekday-date
  pair checks are skipped - if you know when the call ran, pass the flag
- on non-English transcripts; the temporal lexicons are English-only
- to prove the callee misunderstood the time; the card grades the agent's
  wording only, never the callee's comprehension or intent
- during a call; strictly post-call analysis plus pre-call goal crafting

## Verdicts

| Verdict | Meaning |
|---|---|
| `NO_TIME_REFERENCES` | the agent's turns contain no detectable time expression at all |
| `INTERNAL_DATE_CONFLICT` | the agent's own turns disagree with the calendar (stated weekday vs date) or restate a clock hour with a different value |
| `RELATIVE_ONLY_COMMITMENTS` | a commitment turn carries time expressions but never reaches a full absolute anchor anywhere the call supports it |
| `AMBIGUOUS_TIME_REFERENCES` | time references exist and no commitment failed, but ambiguous ones remain (dialect-dependent weekdays, day-part bands, meridiem-less clocks, week ranges) |
| `FULLY_ANCHORED` | every committed time resolves to an absolute date and a meridiem-bearing clock time |

## How It Works

```bash
python3 scripts/call_temporal_anchor_auditor.py analyze \
  --call-result path/to/call-result.json \
  --called-at 2026-10-07T09:00:00-07:00
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or a bare JSON array of `{speaker, text}` turns. Only AGENT turns are
audited; callee time mentions are counted but never graded.

Collection classes:

- `absolute_date`: "October 14", "the 14th of October", "10/14" (US MM/DD),
  and bare ordinal days ("the 14th") whose month is inferred from the call
  timestamp
- `clock_absolute`: clock times with meridiem ("at 2 p.m."), canonicalized
  to 24h values; meridiem-less forms are `clock_ambiguous` - "at 2" and
  colon times at or below 12 ("at 2:30") could be morning or afternoon,
  while 13-23 colon times ("14:30") are true 24-hour clocks
- `invalid_date`: a calendar date that does not exist in the call year
  ("February 29" in 2026) - never satisfies anchoring
- `band`: day-part phrases ("in the evening", "tomorrow morning", "at noon")
  - vague on their own, no clock inside
- `relative_resolved` / `relative_derived`: "tomorrow", "in two weeks",
  "a week from today", bare weekdays - resolved only with `--called-at`; a
  bare weekday resolves to the next strictly future occurrence and is never
  guessed for "next/this <weekday>", which is flagged `ambiguous`
  (dialect-dependent)
- `unresolvable_without_call_time`: relatives and bare ordinal days seen
  with no `--called-at`

Resolution rules worth knowing:

- "next month" resolves to the same day next month, clamped to the target
  month's end (Jan 31 -> Feb 28 in non-leap years)
- a bare weekday never resolves to today; strictly future, at least tomorrow
- "next <weekday>" and "this <weekday>" are never resolved; their meaning
  varies by dialect, so they always flag

Conflict rules (any one forces `INTERNAL_DATE_CONFLICT`):

- (a) a weekday+date pair in one turn contradicts the calendar of the
  `--called-at` year ("Tuesday, October 14" when Oct 14 is a Wednesday)
- (b) the same resolved date is stated with different weekdays across turns
- (c) the same 12-hour clock number is restated with a different value or
  meridiem ("at 2" plus "at 3 p.m." both keyed to hour 12)

Commitment anchoring: turns matching commitment verbs (confirm, reserve,
book, see you, pickup, appointment, ...) that carry time expressions get a
`RELATIVE_ONLY_COMMITMENT` finding unless the slot reaches a full anchor -
a date anchor plus a `clock_absolute` - which may live anywhere in the call;
anchoring is call-level, so a restatement can lean on the anchor stated
earlier.

### Craft the absolute-time goal

```bash
python3 scripts/call_temporal_anchor_auditor.py craft \
  --task "confirm the catering pickup" \
  --date "Wednesday, October 14" --time "2 p.m."
```

Emits a plan_call goal whose time-discipline block demands weekday +
calendar date + clock time + meridiem on every commitment, forbids bare
"next <weekday>" and dateless "tomorrow", and requires the full anchor to be
read back once. See `references/example-goal.txt` for a realistic result.

## Limitations

- Evidence `text` fields for clock times can render with the trailing dot
  trimmed ("at 2 p.m") while the `value` stays canonical ("14:00"); judge
  anchoring by values, not by the echoed text.
- Clock conflict rule (c) keys on the 12-hour number, so "open at 9 a.m."
  plus "appointment at 9 p.m." in one call flags an INTERNAL_CLOCK_CONFLICT
  even though both statements may be correct. Treat clock conflicts as a
  prompt to read the turns, not as proof of a contradiction.
- The PII masker hides numeric dates with 7+ total digits before analysis
  ("10/14/2026" becomes "#" padding), so fully numeric ISO-style dates are
  invisible to the auditor. State dates as month names ("October 14") in
  goals and verify such dates manually.
- Slash dates assume US MM/DD ordering; "10/14" is October 14, never
  10 October in a DD/MM reading.
- "this/next week" and "this/next weekend" classify as `ambiguous` with
  reason "week-range reference without a concrete day" even when
  `--called-at` is given; a week range never resolves to a day.
- A weekday preceded by an ordinal or frequency word ("first Friday",
  "every Tuesday", "last Monday") classifies as `ambiguous` with reason
  "complex ordinal weekday expression"; the "nth weekday of a month"
  computation is dialect- and calendar-dependent, so it is flagged, never
  resolved.
- Commitment anchoring is call-level: an anchor anywhere in the call
  satisfies every commitment turn, so a locally vague restatement of an
  already-anchored slot will not flag.

## Testing

```bash
python3 -m pytest skills/call-temporal-anchor-auditor -q
```

81 tests cover the collector, resolver, conflict rules, commitment
findings, verdict priority, CLI battery, craft mode, and the shipped
fixtures. `references/examples.md` shows byte-real runs against them.

## Research & Standards Grounding

| Research | Relevance |
|---|---|
| Fatemi, Kazemi, Tsitsulin, Malkan, Yim, Palowitch, Seo, Halcrow, Perozzi. "Test of Time: A Benchmark for Evaluating LLMs on Temporal Reasoning". arXiv:2406.09170 (2024). | Large-scale evidence that temporal reasoning is a measured LLM weakness across order, duration, and absolute/relative references - the failure class this skill audits on call transcripts |
| Su, Li, Zhang, Zhu, Qu, Zhou, Bowen, Cheng, Zhang. "Living in the Moment: Can Large Language Models Grasp Co-Temporal Reasoning?" (CoTempQA). ACL 2024. arXiv:2406.09072. | Shows co-temporal reasoning (aligning statements with a reference time) degrades even in strong models - exactly the resolution this skill performs deterministically against `--called-at` |
| Wei, Li, Song, Luo, Zhuang, Tan, Guo, Wang. "TIME: A Multi-level Benchmark for Temporal Reasoning of LLMs in Real-World Scenarios" (includes TIME-Dial, a dialogue sub-benchmark). NeurIPS 2025 (Spotlight). arXiv:2505.12891. | Demonstrates the weakness persists in dialogue settings (TIME-Dial), the register CALL-E transcripts live in |
| ISO 24617-1:2012 "Language resource management - Semantic annotation framework (SemAF) - Part 1: Time and events (SemAF-Time, ISO-TimeML)". International standard, https://www.iso.org/standard/37331.html (confirmed current by its 2023 systematic review). | The standards model for annotating absolute vs relative time expressions and resolving them against a reference time - this skill's collection classes follow the same shape as deterministic heuristics |

Together the three 2024-2025 benchmarks evidence that temporal reasoning -
including in dialogue (TIME-Dial) - is a measured LLM weakness, and
ISO-TimeML is the standards model for absolute vs relative time expressions
resolved against a reference time; this skill operationalizes both as
deterministic transcript heuristics, not as a model judgment.

Citation note: the Test of Time author list is nine names with Fatemi as
first author; some secondary sources misattribute the paper, so cite Fatemi.

## Differences from sibling skills

- `call-cross-call-consistency-checker` compares stated facts across two
  calls; this skill compares the agent's time wording against the calendar
  within one call.
- `call-agent-commitment-tracker` inventories what was promised; this skill
  grades whether the promised times would survive a calendar check.
- `appointment-confirm` and `no-show-shield` act on bookings; this skill is
  a read-only post-call audit that feeds them a verifiable anchor.
