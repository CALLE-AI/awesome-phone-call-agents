# Safety: call-motivational-interviewing-fidelity-auditor

## Masking before analysis

- Any 7+-digit run (separators included) is masked in every turn before
  any coding begins, keeping only the last two characters. Phone digits
  never classify into a behavior category and never appear in a card.
- This is a heuristic masker, not anonymization: names, emails, and
  short numeric fragments are out of its scope. Keep real transcripts
  and cards private; review them before sharing.

## Data handling

- The skill never places calls, makes no network requests, stores no
  person-level data, and processes no audio: it reads one JSON file,
  prints one card, and exits.
- Fixtures use fictional numbers in the +1 555-01xx block only.

## Escalation routing

- `NON_ADHERENT` (any confrontation or warning, OR >= 3 unpermitted
  advice sentences): a human reviews the call, and the goal template is
  reworked before more calls go out in that style.
- `PARTIALLY_ADHERENT`: inspect the weakest counters - zero reflections,
  closed-heavy questioning - and adjust the template; no call to alarm.
- `NOT_MI_CALL`: abstain. This is the honest answer, not an error; do
  not grade agent style on a call that never became an MI conversation.
- Any consequential decision stays with a human; the card names what to
  review, it does not authorize anyone to act.

## Clinical disclaimer

- This is NOT a clinical instrument and NOT certified MI coding. It is
  heuristic lexical coding inspired by the MITI 4.2.1 instrument.
- Never use this skill to evaluate human clinicians or therapists; the
  behavior being graded is the AGENT's, in an experimental phone
  application.
- Counts and ratios are the product; the verdict is a coarse summary
- the fixed disclaimer on every card says exactly this.

## Boundaries

- `call-negotiation-coach` owns pre-call strategy coaching for
  negotiations; this skill audits MI fidelity after behavior-change
  calls.
- `call-apology-effectiveness-auditor` owns post-grievance repair
  quality; this skill owns behavior-change coaching style.
- `call-leading-question-guard` owns coercive question form; this skill
  counts the broader MI behavior profile of which questions are one
  part.
- `bridgecalle-active-listener` is the vertical senior check-in
  application; this skill is the horizontal fidelity auditor any
  health-call app can gate on.

## Limitations

- English lexicons only; no multilingual coverage.
- Heuristic lexical coding inspired by MITI 4.2.1 - stems, not deep
  reflection coding: "It sounded like..." variants are covered, but
  paraphrase reflections without lexical stems are undercounted.
- Permission is same-turn only: an earlier turn's permission does not
  carry into a later turn's advice.
- Wh-initial questions grade open, including "How about...?"
  (effectively a closed offer); auxiliary-initial questions grade
  closed, including "Could you tell me about...?" (effectively an open
  invitation) - deterministic rules, documented, not special-cased.
- A string-form transcript becomes a single agent turn: callee change
  talk is never present and the verdict is NOT_MI_CALL - supply real
  turn lists.
- Masked digits never classify; they are unreadable by design.
- `low_sample` advisory fires under 6 agent turns; counts over so few
  sentences are fragile evidence.
