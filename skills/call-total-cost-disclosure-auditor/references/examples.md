# Examples: call-total-cost-disclosure-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: a fully disclosed deposit before the booking question (FULL_DISCLOSURE_BEFORE_CONSENT)

Fixture: `references/example-transcript.json` - the agent states the $20 per
guest deposit, its refundability and the cancellation window, then asks.

Command:

```bash
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py analyze \
  --transcript skills/call-total-cost-disclosure-auditor/references/example-transcript.json
```

Output:

```json
{
  "call_id": "demo-cost-001",
  "verdict": "FULL_DISCLOSURE_BEFORE_CONSENT",
  "commitment_elicitation": {
    "turn_index": 2,
    "snippet": "Shall I reserve it for you?"
  },
  "consent_point": 3,
  "disclosures": {
    "total_amount": {
      "covered": true
    },
    "recurring": {
      "required": true,
      "covered": true
    },
    "fees_restrictions": {
      "required": true,
      "covered": true
    }
  },
  "drip_evidence": null,
  "reason": "total amount and all required disclosure elements preceded consent",
  "counts": {
    "agent_turns": 3,
    "amounts_pre_consent": 1,
    "fee_mentions_total": 1
  },
  "disclaimer": "Presence-and-timing audit only. The skill cannot verify a stated amount is the true or complete price, only that a total was spoken before consent; multi-item calls may interleave disclosures; digits-and-'dollars' lexicon only (no number words, no non-USD currencies in v1). Findings route to review."
}
```

The callee heard the amount, the per-guest recurring term, and the
deposit/cancellation restrictions before saying "Sure, please do." - the
post-consent confirmation introduces nothing new.

## Example 2: the handling fee revealed after consent (DRIP_PRICING_DETECTED)

Fixture: `references/example-transcript-drip.json` - the $45 total is
stated, the order is placed, and only then a $6 handling fee appears.

Command:

```bash
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py analyze \
  --transcript skills/call-total-cost-disclosure-auditor/references/example-transcript-drip.json
```

Output:

```json
{
  "call_id": "demo-cost-001-drip",
  "verdict": "DRIP_PRICING_DETECTED",
  "commitment_elicitation": {
    "turn_index": 2,
    "snippet": "Do you want to place the order?"
  },
  "consent_point": 3,
  "disclosures": {
    "total_amount": {
      "covered": true
    },
    "recurring": {
      "required": false,
      "covered": false
    },
    "fees_restrictions": {
      "required": true,
      "covered": false
    }
  },
  "drip_evidence": {
    "turn_index": 4,
    "sentence": "Great, just so you know, there is a $6 handling fee added at checkout.",
    "kind": "fee_first_mentioned_post_consent"
  },
  "reason": "drip pricing: fee first mentioned after consent (turn 4)",
  "counts": {
    "agent_turns": 3,
    "amounts_pre_consent": 1,
    "fee_mentions_total": 2
  },
  "disclaimer": "Presence-and-timing audit only. The skill cannot verify a stated amount is the true or complete price, only that a total was spoken before consent; multi-item calls may interleave disclosures; digits-and-'dollars' lexicon only (no number words, no non-USD currencies in v1). Findings route to review."
}
```

The total itself was disclosed correctly, which makes the drip stand out:
fees were never mentioned before consent, and the first fee sentence lands
one turn after "Yes, go ahead."

## Example 3: the recurring term surfacing only after consent (PARTIAL_DISCLOSURE)

Fixture: `references/example-transcript-partial.json` - the $45 total is
stated before the sign-up question, but "per month" first appears after
consent, so recurring terms were required yet never disclosed up front.

Command:

```bash
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py analyze \
  --transcript skills/call-total-cost-disclosure-auditor/references/example-transcript-partial.json
```

Output:

```json
{
  "call_id": "demo-cost-002",
  "verdict": "PARTIAL_DISCLOSURE",
  "commitment_elicitation": {
    "turn_index": 2,
    "snippet": "Would you like to proceed today?"
  },
  "consent_point": 3,
  "disclosures": {
    "total_amount": {
      "covered": true
    },
    "recurring": {
      "required": true,
      "covered": false
    },
    "fees_restrictions": {
      "required": false,
      "covered": false
    }
  },
  "drip_evidence": null,
  "reason": "mentioned in the call but not before consent: recurring terms",
  "counts": {
    "agent_turns": 3,
    "amounts_pre_consent": 1,
    "fee_mentions_total": 0
  },
  "disclaimer": "Presence-and-timing audit only. The skill cannot verify a stated amount is the true or complete price, only that a total was spoken before consent; multi-item calls may interleave disclosures; digits-and-'dollars' lexicon only (no number words, no non-USD currencies in v1). Findings route to review."
}
```

It is not drip pricing: the post-consent "$45 per month" repeats the
already-disclosed amount, so no NEW money term appears after consent. The
finding is timing only - the charge's recurring nature surfaced after the
callee had already said yes.

## Example 4: craft the transparent-offer goal

Command:

```bash
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py craft \
  --scenario transparent-offer
```

Output:

```json
{
  "skill": "call-total-cost-disclosure-auditor",
  "scenario": "transparent-offer",
  "language": "en",
  "goal_template": "You are placing a booking or order call. Before you ask for any commitment, state the offer block in full: the total price in dollars, the frequency if the charge is recurring (for example per month), any fees, taxes, deposits or key restrictions such as the cancellation window - or an explicit line that there are no additional fees. Only after that block is complete, ask exactly ONE commitment question, for example 'Would you like to book?'. After the commitment question, introduce no new amounts, fees, or conditions: if the person asks, answer, but never volunteer a charge they have not heard. If you cannot state the full price, say so and do not ask for the commitment yet.",
  "checklist": [
    "offer block before commitment",
    "single commitment question",
    "recurring frequency stated when applicable",
    "no new amounts after commitment"
  ]
}
```
