# Examples: call-ai-disclosure-comprehension-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: a fully compliant opening (FULL)

Fixture: `references/example-transcript.json` - disclosure in the first
sentence, an explicit comprehension question in the same breath, and a
captured acknowledgment before any business content.

Command:

```bash
python3 skills/call-ai-disclosure-comprehension-auditor/scripts/disclosure_comprehension_auditor.py analyze \
  --transcript skills/call-ai-disclosure-comprehension-auditor/references/example-transcript.json
```

Output:

```json
{
  "skill": "call-ai-disclosure-comprehension-auditor",
  "analysis_mode": "heuristic",
  "disclosure_assessment": "assessed",
  "reason": null,
  "disclosure_present": true,
  "disclosure_early": true,
  "comprehension_check_present": true,
  "acknowledgment_captured": true,
  "evidence": [
    {
      "kind": "disclosure",
      "turn_index": 0,
      "span": "Hello, this is an automated assistant - an AI program - calling on behalf of Example Grocers. Do you understand that you are talking to an automated assistant?"
    },
    {
      "kind": "comprehension_check",
      "turn_index": 0,
      "span": "Hello, this is an automated assistant - an AI program - calling on behalf of Example Grocers. Do you understand that you are talking to an automated assistant?"
    },
    {
      "kind": "acknowledgment",
      "turn_index": 1,
      "span": "Yes, I understand. What is this about?"
    }
  ],
  "verdict": "FULL",
  "recommended_action": {
    "action": "continue",
    "guidance": "Disclosure was early, checked, and acknowledged."
  },
  "disclaimer": "Heuristic text-only analysis. Absence of a captured acknowledgment does not prove the person failed to understand - people understand and stay silent all the time. This card measures what the transcript shows, offers compliance-routing advice, and is not legal advice."
}
```

## Example 2: no disclosure anywhere (UNDISCLOSED)

Fixture: `references/example-transcript-undisclosed.json` - a perfectly
polite call that never tells the person an AI is speaking.

Command:

```bash
python3 skills/call-ai-disclosure-comprehension-auditor/scripts/disclosure_comprehension_auditor.py analyze \
  --transcript skills/call-ai-disclosure-comprehension-auditor/references/example-transcript-undisclosed.json
```

Output:

```json
{
  "skill": "call-ai-disclosure-comprehension-auditor",
  "analysis_mode": "heuristic",
  "disclosure_assessment": "assessed",
  "reason": null,
  "disclosure_present": false,
  "disclosure_early": false,
  "comprehension_check_present": false,
  "acknowledgment_captured": false,
  "evidence": [],
  "verdict": "UNDISCLOSED",
  "recommended_action": {
    "action": "redial_with_disclosure_goal",
    "guidance": "No AI disclosure was found in any agent turn. Use the craft mode goal for future calls; for this record, a human must decide what to tell the person."
  },
  "disclaimer": "Heuristic text-only analysis. Absence of a captured acknowledgment does not prove the person failed to understand - people understand and stay silent all the time. This card measures what the transcript shows, offers compliance-routing advice, and is not legal advice."
}
```

Intermediate verdicts from the tests: LATE_DISCLOSURE (disclosure after
the first agent turn), DISCLOSED_NO_CHECK (disclosure without a
comprehension question), PARTIAL_NO_ACK (question asked, no affirmative
reply visible). A check placed after business content already delivered
does not count - the pitch cannot precede the person's knowing consent.

## Example 3: craft the disclosure-first goal

Command:

```bash
python3 skills/call-ai-disclosure-comprehension-auditor/scripts/disclosure_comprehension_auditor.py craft \
  --scenario disclosure-first-call
```

Output:

```json
{
  "skill": "call-ai-disclosure-comprehension-auditor",
  "mode": "craft",
  "scenario": "disclosure-first-call",
  "language": "en",
  "goal": "You are an automated assistant - an AI program - placing this call. Say so in your FIRST sentence, in plain words: who you are, that you are an automated assistant, and who you are calling on behalf of. Then ask one short comprehension question, for example 'Do you understand that you are talking to an automated assistant?', and pause for the answer before anything else. If the person asks what that means, explain in one sentence and ask again. Only after the person acknowledges do you continue to the reason for the call. If the person objects to talking to an AI at any point, offer to have a human colleague call back instead.",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```
