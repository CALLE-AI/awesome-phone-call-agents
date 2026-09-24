# call-agent-commitment-tracker — Examples

Real outputs captured by running the CLI against the committed fixtures.

---

## Example 1: `COMMITMENTS_FOUND` — multiple commitments with deadlines

**Input fixture:** `references/example-transcript-commitments.json`

```bash
python3 scripts/commitment_tracker.py analyze \
  --transcript references/example-transcript-commitments.json
```

**Output card:**
```json
{
  "call_id": "run-commit-001",
  "skill": "call-agent-commitment-tracker",
  "analysis_mode": "heuristic",
  "commitment_assessment": "assessed",
  "reason": null,
  "commitments": [
    {
      "turn_index": 2,
      "classification": "WITH_DEADLINE",
      "evidence": "I will send you a confirmation email within the next 30 minutes with all the details."
    },
    {
      "turn_index": 4,
      "classification": "WITH_DEADLINE",
      "evidence": "I will have our records team send the referral form to your provider by end of day today."
    },
    {
      "turn_index": 4,
      "classification": "WITH_DEADLINE",
      "evidence": "If there are any issues, someone will call you back within 24 hours."
    },
    {
      "turn_index": 6,
      "classification": "WITH_DEADLINE",
      "evidence": "We will also send a reminder text message tomorrow morning."
    }
  ],
  "commitment_count": {
    "WITH_DEADLINE": 4,
    "WITHOUT_DEADLINE": 0,
    "CONDITIONAL": 0
  },
  "verdict": "COMMITMENTS_FOUND",
  "recommended_action": {
    "action": "schedule_followup_call",
    "guidance": "Found 4 agent commitment(s): 4 with a deadline, 0 without a deadline, 0 conditional. Use the craft mode to generate a follow-up call goal to verify fulfillment."
  },
  "disclaimer": "Heuristic text-only analysis of agent turns. ..."
}
```

---

## Example 2: `NONE_FOUND` — informational call, no pledges made

**Input fixture:** `references/example-transcript-none.json`

```bash
python3 scripts/commitment_tracker.py analyze \
  --transcript references/example-transcript-none.json
```

**Output card (abridged):**
```json
{
  "call_id": "run-commit-002",
  "verdict": "NONE_FOUND",
  "commitments": [],
  "commitment_count": {"WITH_DEADLINE": 0, "WITHOUT_DEADLINE": 0, "CONDITIONAL": 0},
  "recommended_action": {
    "action": "no_followup_required",
    "guidance": "No agent commitments detected. No follow-up call required for commitment tracking."
  }
}
```

---

## Example 3: `craft` — generate a commitment-followup call goal

```bash
python3 scripts/commitment_tracker.py craft --scenario commitment-followup
```

**Output:**
```json
{
  "skill": "call-agent-commitment-tracker",
  "mode": "craft",
  "scenario": "commitment-followup",
  "language": "en",
  "goal": "You are following up on a previous call to verify whether commitments made by our organization have been carried out. Open by introducing yourself as an automated assistant and referencing the prior call. Ask the contact to confirm: (1) whether they received what was promised (e.g., a callback, an email, a document, an action), and (2) whether the timeline was met. Listen carefully. If the commitment was not fulfilled, acknowledge the gap without placing blame, and note that a human colleague will follow up to resolve it. Do not make new commitments during this call. End politely whether or not the commitment was confirmed.",
  "notes": [
    "Heuristic skill: adapt the goal text to the specific unfulfilled commitment.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

---

## Commitment Classification Examples

| Agent utterance | Classification | Reason |
|---|---|---|
| "I'll send you an email within 30 minutes." | `WITH_DEADLINE` | "within 30 minutes" deadline marker |
| "We'll follow up with you soon." | `WITH_DEADLINE` | "soon" deadline marker |
| "I will look into this matter." | `WITHOUT_DEADLINE` | No time constraint |
| "Someone will call you back." | `WITHOUT_DEADLINE` | Delegation, no deadline |
| "I will process this if you send us the form." | `CONDITIONAL` | "if" condition present |
| "We will arrange a callback once the team is available." | `CONDITIONAL` | "once" condition present |

---

## PII Masking in Evidence

Any number run of 7+ digits is masked, keeping the last 2 characters:

```
Input:  "I will call you at +14155550171 within the hour."
Output: "I will call you at +1415555##71 within the hour."
```

Phone numbers in the `555-01xx` block (PR #288 standard) are correctly masked
in evidence spans while remaining identifiable as test fixtures.
