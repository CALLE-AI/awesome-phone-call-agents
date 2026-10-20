# Research Foundation - call-arithmetic-accuracy-auditor

Each citation below is mapped to the concrete design decisions it drives.
Citations are motivation and anchoring only: this skill implements
deterministic offline recomputation (integer/decimal arithmetic done in
Python, not in any model), and none of the papers' models, benchmarks,
or performance results are reproduced or validated here.

| Citation | Exact URL | Function | Design decision it drives |
|---|---|---|---|
| Dziri et al. (16 authors). "Faith and Fate: Limits of Transformers on Compositionality." NeurIPS 2023 Spotlight. | <https://arxiv.org/abs/2305.18654> | Method anchor | Transformers solve multi-digit multiplication via linearized subgraph matching, not true computation - verification must be external to the model. |
| Mirzadeh, I., Alizadeh, V., Shahrokhi, H., Tuzel, O., Bengio, S., Farajtabar, M. (6 authors, Apple). "GSM-Symbolic: Understanding the Limitations of Mathematical Reasoning in Large Language Models." ICLR 2025. | <https://arxiv.org/abs/2410.05229> | Failure-mode evidence | Accuracy degrades when numeric values change - clean-sounding factors do not guarantee a correct spoken total. |
| Wei, J., Wang, X., Kim, J., Chen, G. (4 authors). "Towards Spoken Mathematical Reasoning: Benchmarking Speech-based Models over Multi-faceted Math Problems." arXiv 2025. | <https://arxiv.org/abs/2505.15000> | Modality-specific evidence | Cascade ASR+LLM pipelines (CALL-E's architecture) struggle with direct arithmetic in spoken form. |
| Federal Trade Commission. "FTC Policy Statement on Deception" (1983). | <https://www.ftc.gov/legal-library/browse/ftc-policy-statement-deception> | Normative | A wrong spoken total is a material misrepresentation to a consumer acting reasonably. |

## Verification notes and corrections

- All four URLs were fetched from their source pages on 2026-10-19.
- Faith and Fate has 16 authors and is frequently miscited with fewer;
  the full author list was confirmed on the arXiv abstract page. It is a
  NeurIPS 2023 Spotlight.
- GSM-Symbolic's arXiv comments field reads "ICLR camera ready"; it is
  cited here as ICLR 2025.
- Spoken Mathematical Reasoning (Spoken-MQA) is an arXiv preprint with
  no venue claimed; it is cited as arXiv 2025, not as a published paper.
- 16 CFR Part 233 (FTC Guides Against Deceptive Pricing) was considered
  and rejected as a citation: it covers former-price comparisons, not
  arithmetic accuracy.
- The recomputation in this skill is deterministic Python arithmetic;
  the cited papers' model results do not transfer to it and are used as
  motivation only.
