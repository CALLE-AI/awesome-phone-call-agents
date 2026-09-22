# Examples: call-repair-sequence-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: a high-trouble call with four repair types

Fixture: `references/example-transcript.json` - a depot pickup call whose
opening turn packs a date, a time window, and an address into one sentence.
The callee initiates four different kinds of repair; the agent resolves
three and pivots away from one.

Command:

```bash
python3 skills/call-repair-sequence-auditor/scripts/repair_sequence_auditor.py analyze \
  --transcript skills/call-repair-sequence-auditor/references/example-transcript.json
```

Output:

```json
{
  "skill": "call-repair-sequence-auditor",
  "analysis_mode": "heuristic",
  "repair_assessment": "assessed",
  "reason": null,
  "comprehension_trouble": "HIGH",
  "repair_events": [
    {
      "repair_turn_index": 1,
      "repair_type": "open_class",
      "span": "Sorry, what?",
      "trouble_source_index": 0,
      "trouble_profile": [
        "digit_dense"
      ],
      "resolution": "ADDRESSED"
    },
    {
      "repair_turn_index": 3,
      "repair_type": "candidate_understanding",
      "span": "Is it the 12th or the 21st?",
      "trouble_source_index": 2,
      "trouble_profile": [
        "digit_dense"
      ],
      "resolution": "ADDRESSED"
    },
    {
      "repair_turn_index": 5,
      "repair_type": "repetition_request",
      "span": "Can you repeat that?",
      "trouble_source_index": 4,
      "trouble_profile": [
        "digit_dense"
      ],
      "resolution": "IGNORED"
    },
    {
      "repair_turn_index": 7,
      "repair_type": "specification_request",
      "span": "Wait, which one?",
      "trouble_source_index": 6,
      "trouble_profile": [
        "unremarkable"
      ],
      "resolution": "ADDRESSED"
    }
  ],
  "repairs_initiated": 4,
  "unresolved_repairs": 1,
  "dominant_trouble_type": "digit_dense",
  "repair_baseline_note": "Human conversation runs at roughly one repair every 1.4 minutes (Dingemanse et al. 2015, twelve-language sample). Transcripts carry no reliable offsets here, so this card reports counts per call instead of a rate; treat the baseline as illustrative only.",
  "recommended_action": {
    "action": "redial_with_simplified_goal",
    "guidance": "You are calling back a person who had trouble following the previous call. Use short turns: one fact per sentence, at most two sentences before you pause for a reply. Say numbers one digit at a time, then ask the person to read them back. Tell the person early and plainly who is calling and what the call is about. Say explicitly at the start: if anything is unclear, please stop me and I will repeat it slowly. When the person asks you to repeat, do not restate the same long sentence - shorten it, slow it down, and repeat only the part they asked about."
  },
  "disclaimer": "Heuristic text-only conversation analysis. Repair detection here is a lexical approximation of conversation-analytic other-initiated repair; prosodic and timing cues are invisible in transcripts, so counts under-report rather than over-report. Verdicts advise a human, they decide nothing."
}
```

Every repair is localized to the agent turn that caused it, profiled (the
dominant trouble type here is digit-dense wording), and the one IGNORED
repair is what pushes the card to recommend a simplified redial goal.

## Example 2: a low-trouble call

Fixture: `references/example-transcript-low.json`.

Command:

```bash
python3 skills/call-repair-sequence-auditor/scripts/repair_sequence_auditor.py analyze \
  --transcript skills/call-repair-sequence-auditor/references/example-transcript-low.json
```

Output:

```json
{
  "skill": "call-repair-sequence-auditor",
  "analysis_mode": "heuristic",
  "repair_assessment": "assessed",
  "reason": null,
  "comprehension_trouble": "LOW",
  "repair_events": [],
  "repairs_initiated": 0,
  "unresolved_repairs": 0,
  "dominant_trouble_type": null,
  "repair_baseline_note": "Human conversation runs at roughly one repair every 1.4 minutes (Dingemanse et al. 2015, twelve-language sample). Transcripts carry no reliable offsets here, so this card reports counts per call instead of a rate; treat the baseline as illustrative only.",
  "recommended_action": {
    "action": "continue",
    "guidance": null
  },
  "disclaimer": "Heuristic text-only conversation analysis. Repair detection here is a lexical approximation of conversation-analytic other-initiated repair; prosodic and timing cues are invisible in transcripts, so counts under-report rather than over-report. Verdicts advise a human, they decide nothing."
}
```

## Example 3: craft the simplified redial goal

Command:

```bash
python3 skills/call-repair-sequence-auditor/scripts/repair_sequence_auditor.py craft \
  --scenario high-trouble-redial
```

Output:

```json
{
  "skill": "call-repair-sequence-auditor",
  "mode": "craft",
  "scenario": "high-trouble-redial",
  "language": "en",
  "goal": "You are calling back a person who had trouble following the previous call. Use short turns: one fact per sentence, at most two sentences before you pause for a reply. Say numbers one digit at a time, then ask the person to read them back. Tell the person early and plainly who is calling and what the call is about. Say explicitly at the start: if anything is unclear, please stop me and I will repeat it slowly. When the person asks you to repeat, do not restate the same long sentence - shorten it, slow it down, and repeat only the part they asked about.",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

The goal is the same template the HIGH card recommends, so analysis and the
next call stay consistent.
