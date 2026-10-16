---
name: call-motivational-interviewing-fidelity-auditor
description: Offline experimental CALL-E helper that codes agent turns in health-behavior calls against MITI-4.2.1-inspired lexical categories (reflections, open questions, permission-gated advice, confrontation) and grades MI adherence, abstaining honestly when no change talk is present; not certified MI coding, a clinical judgment, or authorization to act.
license: MIT
research: arXiv:2403.15737
---

# call-motivational-interviewing-fidelity-auditor

> **Behavior-change calls deserve the same fidelity scrutiny
> clinicians get. Counts first, verdict second, honesty always.**

This repo is full of health-call applications - refill reminders,
adherence callbacks, care check-ins - and every one of them assumes the
agent *coached* the patient rather than lectured them. Nothing in the
sibling skills codes WHETHER the agent actually practiced Motivational
Interviewing: did it reflect, ask open questions, gate advice behind
permission - or did it slip into "you should" and "if you keep skipping"
confrontation? This skill is a heuristic lexical coder inspired by the
MITI 4.2.1 instrument: it classifies every agent sentence, counts the
behaviors, derives the classic ratios, and grades a coarse verdict -
abstaining honestly with NOT_MI_CALL when the callee never voiced any
change talk. The counts and ratios are the product; the verdict is a
coarse summary, not a clinical judgment.

## When To Use

- after any behavior-change call - refill reminder, medication
  adherence, care check-in - before trusting that the agent coached
  rather than lectured
- when iterating on goal templates to improve agent style: run the
  audit, read the weakest counters, adjust the template, re-run
- as a gate between `get_call_run` and any automation that acts on how
  the call went

## When Not To Use

- as a clinical instrument or therapist QA; this is heuristic lexical
  coding of a phone agent, never a basis for evaluating human clinicians
- on calls with no change talk: NOT_MI_CALL is the honest abstention,
  not an error - grading agent style on a call that was never an MI
  conversation would be noise
- on non-English transcripts; all lexicons are English-only stems
- as a lie detector or intent test; it counts sentence shapes, it does
  not read minds

## Verdicts

| Verdict | Meaning | Suggested routing |
|---|---|---|
| `MI_ADHERENT` | zero non-adherent behaviors, at least one reflection, open questions >= closed questions | proceed, keep the card as evidence |
| `PARTIALLY_ADHERENT` | catch-all: zero reflections, closed-heavy questioning, or scattered unpermitted advice below the threshold | review the weakest counters before trusting the style |
| `NON_ADHERENT` | any confrontation or warning, OR >= 3 pieces of advice without permission | a human reviews the call; template rework before more calls |
| `NOT_MI_CALL` | no callee change talk detected | abstain; do not grade style on a non-MI call |

## How It Works

Four deterministic stages, offline, no LLM:

1. **Mask first.** Any 7+-digit run (separators included) is masked in
   every turn before any coding, keeping the last two characters. Phone
   digits never classify and never leak into the card.
2. **Classify each agent sentence.** First match wins, in precedence
   order: reflection > affirmation > confront > warn (conditional
   "if you don't/keep..." or "without...you'll" shape plus a loss word
   in the same sentence) > advice (permission must start at or before
   the advice sentence within the same turn) > question (open by
   wh-initial or "tell me about"/"walk me through", closed by
   auxiliary-initial or declarative "?") > information statement.
3. **Change-talk gate.** Callee turns are scanned for DARN-flavored
   lexical anchors ("I want to quit", "part of me", "I'd like to",
   ...). No change talk anywhere means the call is not an MI
   conversation and the verdict is NOT_MI_CALL regardless of agent
   style.
4. **Verdict + ratios.** Priority NOT_MI_CALL > NON_ADHERENT >
   MI_ADHERENT > PARTIALLY_ADHERENT. The card also reports
   `reflections_per_question`, `open_question_share`, and a
   `low_sample` advisory when fewer than 6 agent turns were coded.

## Craft: the MI goal template

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py craft
```

Emits a refill-reminder goal that operationalizes OARS - open with an
open question, reflect ("It sounds like..."), ask permission before any
suggestion, roll with resistance, let the patient choose the next step -
so the calls this skill later audits start adherent.

## Foundation

| Function | Citation |
|---|---|
| Method anchor (the coding instrument: behavior counts + global ratings) | Moyers, T. B., Manuel, J. K., & Ernst, D. Motivational Interviewing Treatment Integrity Coding Manual (MITI 4.2.1). https://motivationalinterviewing.org/sites/default/files/miti4_2.pdf |
| Instrument validation evidence | Moyers, T. B., Rowell, L. N., Manuel, J. K., Ernst, D., & Houck, J. M. (2016). "The Motivational Interviewing Treatment Integrity Code (MITI 4): Rationale, Preliminary Reliability and Validity." Journal of Substance Abuse Treatment 65:36-42. DOI 10.1016/j.jsat.2016.01.001, PMID 26874558. CORRECTION vs common miscite: 5 authors, not 3 |
| Foundational framework (4th ed) | Miller, W. R., & Rollnick, S. (2023). Motivational Interviewing: Helping People Change and Grow (4th ed.). Guilford Press, 338 pp. ISBN 9781462552795 (hardcover) / 9781462552801 (e-book). CORRECTION: 4th-ed subtitle is "...Change and Grow" (3rd ed was "Helping People Change") |
| Efficacy + digital-delivery evidence (why fidelity is worth auditing at all; MI works incl. digital applications) | Bahri, A. A. (2025). "Motivational Interviewing to Promote Healthy Lifestyle Behaviors: Evidence, Implementation, and Digital Applications." Journal of Multidisciplinary Healthcare 18:6629-6642. DOI 10.2147/JMDH.S557957. Honest label: narrative review (summarizes RCTs/meta-analyses), NOT itself a meta-analysis |
| Recency (MI dialogue systems with LLMs) | Xie, Z., Majumder, B. P., Zhao, M., Maeda, Y., Yamada, K., Wakaki, H., & McAuley, J. (2024). "Few-shot Dialogue Strategy Learning for Motivational Interviewing via Inductive Reasoning." Findings of ACL 2024. arXiv:2403.15737, https://aclanthology.org/2024.findings-acl.782. Author-list CORRECTIONS pinned from the anthology page: Mengjie Zhao (not Mengxue), Yoshinori Maeda, Keiichi Yamada, Hiromi Wakaki - search snippets had all four wrong |

## Boundaries

- `call-negotiation-coach` owns pre-call strategy coaching for
  negotiations; this skill audits MI fidelity after behavior-change
  calls.
- `call-apology-effectiveness-auditor` owns post-grievance repair
  quality; this skill owns behavior-change coaching style.
- `call-leading-question-guard` owns coercive question *form*; this
  skill counts the broader MI behavior profile of which questions are
  one part.
- `bridgecalle-active-listener` is the vertical senior check-in
  application; this skill is the horizontal fidelity auditor any
  health-call app can gate on.

## Limitations

- English lexicons only; no multilingual coverage
- heuristic lexical coding inspired by MITI 4.2.1 - stems, not deep
  reflection coding: "It sounded like..." variants are covered, but
  paraphrase reflections without lexical stems are undercounted
- permission is same-turn only: an earlier turn's permission does not
  carry into a later turn's advice
- wh-initial questions grade open, including "How about...?" (really a
  closed offer); auxiliary-initial questions grade closed, including
  "Could you tell me about...?" (really an open invitation) -
  deterministic rules, documented, not special-cased
- a string-form transcript becomes a single agent turn: callee change
  talk is never present and the verdict is NOT_MI_CALL - supply real
  turn lists
- masked digits never classify; they are unreadable by design
- `low_sample` advisory fires under 6 agent turns; counts over so few
  sentences are fragile evidence

## Testing

```bash
python3 scripts/test_motivational_interviewing_fidelity_auditor.py
```

Runs offline with plain `python3` and `pytest`, both from the skill
root; see `references/examples.md` for real CLI output on the bundled
fixtures.
