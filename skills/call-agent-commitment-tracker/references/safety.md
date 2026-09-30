# call-agent-commitment-tracker — Safety & Compliance

## What This Skill Does and Does Not Do

**Does:**
- Read finished CALL-E `get_call_run` transcript JSON files offline
- Detect Commissive Speech Acts (future-action pledges) from agent turns only
- Classify commitments by deadline urgency and conditionality
- Mask PII (7+-digit runs, keeping last 2 chars) in all evidence spans
- Emit advisory cards and follow-up call goal templates

**Does not:**
- Dial any phone number or place any call
- Access any network, API, or external service
- Store, log, or transmit any transcript data
- Constitute legal proof of a broken contract or obligation
- Override human judgment on whether to act on a commitment

## PII Handling

Evidence spans in the output card are automatically masked before display.
Any sequence of 7 or more ASCII decimal digits (with common separators:
space, comma, period, slash, hyphen) is masked, keeping only the last 2
characters. This covers phone numbers, account numbers, and similar identifiers.

Test fixtures in this skill use only the NANP standards-reserved fictional
block `555-01xx` (e.g., +14155550188) as required by the repository's
compliance standard (PR #288).

## Scope Limitations

| Limitation | Explanation |
|---|---|
| Heuristic only | Pattern matching on lexical markers; cannot understand semantics or context the way a human reviewer can |
| English lexicon | Commitment and deadline patterns are English-only; non-English commitments may not be detected |
| Text-only | No access to audio prosody, tone, or pauses that might signal a reluctant commitment |
| Sentence boundaries | Complex multi-clause sentences may confuse the sentence splitter |
| Implicit commitments | Very indirect commitments ("let me look into this") may not be detected |

## Advisory Use Only

Every output card includes `analysis_mode: "heuristic"` and a `disclaimer`
field. Findings route to human follow-up verification. Do not use this skill
to automatically trigger legal, financial, or medical actions without human
review.

## Recommended Workflow

1. Run `analyze` after every agent-initiated call where forward-looking
   statements are expected.
2. Review the commitment card with a human operator for high-stakes calls.
3. Use `craft` to generate a follow-up call goal, then review and adapt it
   before placing the follow-up call.
4. Never use the follow-up call goal unmodified for sensitive or regulated
   use cases (healthcare, collections, legal).
