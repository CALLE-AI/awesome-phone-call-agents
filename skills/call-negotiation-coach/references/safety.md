# Safety & Compliance

1. **BATNA Enforcement**: The system strictly flags `BATNA_VIOLATED` if an agent agrees to terms worse than their BATNA floor. This protects users from predatory tactics.
2. **Anti-Pattern Prevention**: By flagging `emotional_capitulation`, the skill ensures agents do not succumb to verbal abuse or pressure tactics, maintaining professional boundaries.
3. **Testing Protocol Compliance**: All unit tests referencing phone numbers or contact data must exclusively use the `555-01xx` numbering block, as mandated by repository rule PR #288.
4. **Advisory Role**: The `debrief` outputs are advisory. "Reached agreement" does not constitute a legally binding signature; it merely reflects transcript heuristics.
