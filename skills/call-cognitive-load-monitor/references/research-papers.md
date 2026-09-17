# Research Papers — call-cognitive-load-monitor

## Primary References (2025–2026)

### arXiv:2606.12971 (2026)
**"Predicting Cognitive Load in Dyadic Conversations via Interaction Dynamics"**
- Authors: Multiple (arXiv preprint, 2026)
- Key finding: Turn-taking overlap frequency, speaker-switch patterns, and participation imbalance between speakers are strong predictors of cognitive load in naturalistic phone-style collaborative tasks. Mental demand correlates with imbalanced participation; temporal demand correlates with conversational overlap events.
- Method: Two-head Gated Recurrent Unit (GRU) encoder processing acoustic + interaction dynamic features from 53 dyads.
- Relevance: Provides the interaction-dynamic marker model used in `monitor_cognitive_load.py`.

### arXiv:2502.06922 (February 2025)
**"Synthetic Audio Data for Cognitive State Modelling"**
- Key finding: Zero-shot synthetic TTS audio can be used to fine-tune cognitive state detection models. Cognitive signals in audio are orthogonal to text-only features — acoustic processing captures information not available in transcripts alone.
- Relevance: Validates that acoustic biomarkers (jitter, shimmer, speech rate changes) carry real cognitive load information separate from word content.

### arXiv:2605.14888 (May 2026)
**"PROCESS-2: Large-Scale Speech Corpus for Cognitive Impairment Assessment"**
- Key finding: Reproducible benchmark for naturalistic conversational variability assessment from spontaneous speech. Defines state-of-the-art for real-world CL detection.
- Relevance: Provides the benchmark standard this skill's heuristics are aligned with.

## Foundational References

### NASA Task Load Index (NASA-TLX)
- Authors: Hart, S.G. & Staveland, L.E.
- Publication: "Development of NASA-TLX (Task Load Index): Results of Empirical and Theoretical Research." *Human Mental Workload*, 1988, pp.139–183.
- Key finding: Six-dimension subjective workload scale (Mental Demand, Physical Demand, Temporal Demand, Performance, Effort, Frustration). The gold-standard CL measurement construct.
- Relevance: The theoretical baseline for what cognitive load measures. Our heuristic markers map to the Mental Demand and Frustration dimensions.

### Cognitive Load Theory — Sweller, van Merriënboer & Paas (2019)
- Authors: Sweller, J., van Merriënboer, J.J.G., & Paas, F.
- Publication: "Cognitive Architecture and Instructional Design: 20 Years Later." *Educational Psychology Review*, 31(2), 2019, pp.261–292.
- Key finding: Germane load (active learning effort), intrinsic load (task difficulty), extraneous load (poor presentation) — the three-component model. Reducing extraneous load (e.g., simplifying jargon) directly improves comprehension.
- Relevance: Provides the theoretical justification for the jargon-simplification patches and the three-load model behind the load categorisation.

## Regulatory References

### FCA Consumer Duty — Final Rules and Guidance PS22/9
- Publisher: Financial Conduct Authority (UK)
- Date: July 2022 (enforcement: July 2024)
- URL: https://www.fca.org.uk/publication/policy/ps22-9.pdf
- Relevance: §4.39 prohibits pressure tactics and false urgency in consumer communications. §4.21 requires identity disclosure. The "Consumer Understanding" outcome requires operators to evidence that customers understood what they agreed to — the primary regulatory hook for the consent-validity flag.

### EU AI Act — Articles 12, 13, 52
- Publisher: Official Journal of the European Union
- Date: Signed 2024, effective February 2025
- Relevance: Article 13 requires that AI systems in contact with natural persons provide clear, comprehensible information. Article 12 requires logging. Article 52 imposes transparency obligations on certain AI systems. A call where cognitive load was critically high during consent creates EU AI Act audit-trail risks.
