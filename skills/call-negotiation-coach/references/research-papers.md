# Research Papers — call-negotiation-coach

## Primary References (2024–2026)

### arXiv:2411.05816 (November 2024)
**"LLM as Strategic Negotiator: Combining Dialogue Fluency with Explicit Strategy"**
- Key finding: Standard LLMs default to "agreeableness bias" — they close deals below their optimal utility floor. Combining explicit strategy modules (tit-for-tat, time-dependent concessions, anchoring) with LLM dialogue fluency produces agents that consistently outperform unconstrained LLM baselines.
- Method: LLM meta-strategist calling upon a library of named tactics at each turn, evaluated on structured negotiation games.
- Relevance: The tactic library and sequence design in `negotiation_coach.py` directly implements this hybrid strategy architecture.

### AgenticPay: Multi-Agent Negotiation Framework (arXiv, 2026)
**"AgenticPay: A Framework for Multi-Agent Buyer-Seller Negotiations"**
- Key finding: BATNA-aware reward design with a "tunable utility floor" prevents AI negotiators from accepting sub-optimal deals. Multi-agent market simulations show that explicit BATNA encoding reduces deal-closing below the floor by >85%.
- Relevance: The `batna_floor_note` field and BATNA violation detection in `debrief` mode are grounded in this reward design framework.

### NegotiationArena (arXiv, 2024)
**"NegotiationArena: Evaluating Negotiation Abilities of LLMs"**
- Key finding: LLMs exhibit identifiable "irrational" negotiation behaviours mirroring human cognitive biases: anchoring susceptibility, sunk-cost fallacy, loss aversion. Pre-emptive concession is one of the most common failure modes.
- Relevance: The `ANTI_PATTERNS` library — especially `pre_emptive_concession` and `positional_bargaining` — is derived from the failure taxonomy documented in NegotiationArena.

### "Warmth × Dominance in AI Negotiation" — MIT Sloan (2024)
**"The Warmth-Dominance Balance in AI-Driven Negotiation"**
- Key finding: Empirical study of AI negotiators. Agents that balance warmth (expressed gratitude, positivity, name use) with dominance (assertiveness, goal-focus) achieve the highest joint and individual value. Pure agreeableness fails to claim value; pure dominance increases impasse rates.
- Relevance: The `warmth_dominance_balance` field and DISC-tactic mapping in `prepare()` implement this dual-concern-aware design.

### "BATNA-Aware Reward Design for LLM Agents" (ResearchGate, 2025)
- Key finding: Encoding BATNA as a reservation price floor in the reward function of LLM negotiation agents prevents sub-optimal deal acceptance. Utility drops sharply when the agent crosses its BATNA — the signal to walk away.
- Relevance: The `batna_violated` detection in `debrief()` and the explicit BATNA floor note in `prepare()` implement this concept.

### "Rapport Building Strategies for Voice Agents" — INTERSPEECH 2024
- Key finding: Small talk, using the counterparty's name, expressing appreciation for the relationship, and sharing a common goal significantly increase willingness-to-concede in subsequent turns.
- Relevance: The `rapport_building` tactic assigned to Steady/Influential DISC archetypes.

## Foundational References

### "Getting to Yes: Negotiating Agreement Without Giving In" — Fisher, Ury & Patton
- 3rd edition, Penguin Books, 2011 (original 1981)
- Key concepts: BATNA, ZOPA, interest-based vs. position-based negotiation, principled negotiation.
- Relevance: BATNA, ZOPA, and the `interest_exploration` tactic.

### Dual Concern Model — Pruitt & Carnevale
- Publication: "Social Conflict: Escalation, Stalemate, and Settlement." McGraw-Hill, 1993.
- Key finding: Negotiation strategy is determined by the 2×2 matrix of concern for own outcome × concern for relationship: Collaborating / Competing / Accommodating / Avoiding.
- Relevance: The `CONCERN_MODE_MAP` and `dual_concern_mode` field directly implement this model.
