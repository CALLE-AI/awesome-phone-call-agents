# Stated limitations

A named limitation beats a silent one. These are the known ways this grader is
wrong or weak, with the mitigation each one gets.

## 1. The latency signal is structurally weak

`offset_seconds` is an integer and marks **turn start**, so the measured gap
includes the previous turn's speaking duration, estimated crudely at 2.5 words per
second. Signal A is therefore noisy in both directions. Mitigation: A is the
weakest signal in the table — it never upgrades alone, only alongside a
corroborating specific (C), and B/C/D are weighted above it.

## 2. ASR errors corrupt hedge detection

The grader sees CALL-E's transcript, not the audio. If ASR drops "should be" or
mangles "let me check", signals D and B silently miss. Fail-closed helps in one
direction (a missed B can only *under*-grade), but a missed hedge *over*-grades to
`asserted` or even `verified` when other positive heuristics are present. Multiple
signals do not guarantee independence or compensate for missing transcript words;
the labels remain advisory and require host validation.

## 3. The lexicon is English-centric

CALL-E supports Hindi and Tamil for `IN` numbers. Code-switched calls will
under-detect hedges: *"Tuesday tak ho jayega, **shayad**"* is a hedged answer the
English lexicon grades `asserted`. This exact case ships as fixture
`23-codeswitch-hindi-hedge-missed.json` and is the single red cell in the
confusion matrix — kept red on purpose, as the honest measurement of this gap.
The lexicon is a swappable JSON file (`scripts/lexicon/en.json`); a drafted Hindi
file (`scripts/lexicon/hi.json`) ships **unvalidated** and must not be trusted until it has its own
labelled fixture set.

## 4. Directness is cultural

A terse answer is not necessarily a guess, and an elaborate one is not necessarily
knowledge. The signals were designed against Indian B2B supplier calls (the
QuoteDesk use case); the round-number heuristic (G) and the corroboration classes
(warehouse names, invoice refs) encode that domain. Transplanting to another
domain means re-labelling fixtures, not just trusting the current thresholds.

## 5. C and H are heuristics in this build

The two semantic signals (corroborating specific, answer alignment) run on a
regex-grade entity spotter. It knows weekdays, durations, prices, stock counts,
place-after-preposition, part numbers and invoice refs — and nothing else. A model
can replace either through its provider interface (spans in, never grades out),
which is expected to widen recall considerably; the rule table and all grades stay
identical and testable either way.

## 6. Not validated against outcomes yet

Every grade is currently a prediction with a rationale, not a calibrated
probability. Nothing here has been checked against whether the shipment actually
arrived on Tuesday. The roadmap in SKILL.md describes the validation loop
(grade → wait → outcome → per-organisation calibration curve); it is unbuilt, and
until it runs, treat the grades as an ordering of trust, not a measurement of it.
