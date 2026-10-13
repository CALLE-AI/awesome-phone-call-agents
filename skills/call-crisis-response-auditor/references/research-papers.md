# Research Foundation - call-crisis-response-auditor

Each citation below is mapped to the concrete design decisions it drives.
Citations are motivation and anchoring only: this skill implements
heuristic lexicons, honestly labeled as heuristics, and none of the
papers' models, benchmarks, or performance results are reproduced or
validated here.

| Citation | Design decisions it drives |
|---|---|
| Method anchor: Byun, G., Lott, A., Lipschutz, R., Minton, S. T., Stinson, E. A., & Choi, J. D. (2026). "Expert-Level Crisis Detection in Mental Health Conversations." arXiv:2606.10380 (v3, 2026-09-11); to appear at the WMHS Workshop, NeurIPS 2026. Introduces CRADLE-Dialogue (600 clinician-annotated dialogues; turn-level, multi-label risks incl. suicide ideation and self-harm). <https://arxiv.org/abs/2606.10380> | Turn-level cue anchoring (findings carry the crisis turn index) and the 3-category taxonomy (medical emergency, self-harm ideation, immediate safety threat). We implement heuristic lexicons, honestly labeled as heuristics, NOT the paper's models. |
| Failure-mode evidence: Weber, S., et al. (2026). "Suicide- and crisis-risk detection using large language models in mental-health chatbots." medRxiv. doi:10.64898/2026.01.12.26343914 (ETH Zurich / Psychiatric University Clinic Zurich; PREPRINT - status disclosed). Conversational crisis detection is inherently uncertain. | Weak signals are advisory-only and never verdict-gating; every CRISIS_* verdict fails open to human review; no auto-triage claims are made anywhere in the skill. |
| Normative official: SAMHSA (2025). "2025 National Guidelines for a Behavioral Health Coordinated System of Crisis Care" (with companion guidance; SAMHSA product PEP24-01-037, 2025-01-15; 104 pp). <https://library.samhsa.gov/product/pep24-01-037> | The escalation-resource checklist (someone to talk to / somewhere to go; 911 / 988 / local emergency) used in both the analyzer's escalation patterns and the craft protocol. |

## Corrections and honesty notes

- Venue and title details for all three sources were pinned by
  primary-source verification during authoring; no later corrections
  needed to be applied to the citations above.
- MentalHealthBench was deliberately NOT cited: its PDF URL could not be
  verified at build time, so it is excluded rather than cited on faith.
- The lexicon heuristics in this skill are NOT validated instruments.
  They are demonstration-grade pattern lists; the cited papers' clinical
  annotation and modeling results do not transfer to them.
- The Weber et al. source is a PREPRINT and is labeled as such; its
  findings are used as failure-mode motivation, not as a validated
  performance claim for this implementation.
