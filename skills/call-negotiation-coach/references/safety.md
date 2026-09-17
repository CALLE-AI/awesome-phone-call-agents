# Safety Reference — call-negotiation-coach

## Scope and Limitations

This skill provides **structured preparation support and post-call reflection** for negotiation calls. It is not:
- A guarantee of negotiation outcome
- A substitute for professional negotiation training in high-stakes contexts
- Legal or financial advice on the terms being negotiated

## The Agreeableness Bias Warning

Research (NegotiationArena 2024, arXiv:2411.05816) shows that unconstrained AI systems exhibit an "agreeableness bias" — they accept deals they should reject. This skill counteracts that by:
- Making the BATNA explicit before the call
- Flagging `batna_violated` in the debrief if the outcome may have crossed the walk-away threshold
- Teaching the `batna_reference` tactic as a deliberate counter to premature capitulation

The `batna_violated` flag is **heuristic**. It checks for numeric percentages in the transcript that may exceed the BATNA figure. A human must verify the actual agreed terms.

## Ethical Boundaries

This skill teaches legitimate, evidence-based negotiation tactics drawn from academic research. It does not teach:
- Deception or misrepresentation
- Manipulation of the counterparty's information
- Tactics that would violate consumer protection laws

The `batna_reference` tactic should never be used to make false claims about alternatives.

## Data Handling

- Negotiation strategy cards may contain commercially sensitive BATNA information. Store securely.
- Debrief cards contain transcript excerpts. Handle as internal business records.
- Never share strategy cards with the counterparty.

## Recommended Human Review

All `BATNA_VIOLATED` flags require human review of the actual agreement terms before ratification.
For multi-million-dollar or legally binding negotiations, always involve a qualified negotiation professional.
