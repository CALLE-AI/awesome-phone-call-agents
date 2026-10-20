# Research Foundation - call-list-capture-completeness-auditor

Each citation below is mapped to the concrete design decisions it drives.
Citations are motivation and anchoring only: this skill implements
heuristic chunking and token-overlap matching, honestly labeled as
heuristics, and none of the papers' models, benchmarks, or performance
results are reproduced or validated here.

| Citation | Design decisions it drives |
|---|---|
| Method anchor: Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., Liang, P. (7 authors) (2024). "Lost in the Middle: How Language Models Use Long Contexts." Transactions of the Association for Computational Linguistics, vol 12, pp. 157-173. <https://arxiv.org/abs/2307.03172> (anthology: <https://aclanthology.org/2024.tacl-1.9/>) | Retrieval degrades for mid-context information - the readback must be audited against the FULL enumerated set, not the most recent items. |
| Failure-mode evidence: Laban, P., Fabbri, A. R., Xiong, C., Wu, C.-S. (4 authors) (2024). "Summary of a Haystack: A Challenge to Long-Context LLMs and RAG Systems." EMNLP 2024 main, pp. 9885-9903. <https://arxiv.org/abs/2407.01370> (anthology: <https://aclanthology.org/2024.emnlp-main.552/>) | Even strong systems drop insights when condensing spread information - dropped-item detection is a real failure surface. |
| Recency + matching policy: Modarressi, M., Deilamsalehy, H., Dernoncourt, F., Bui, T., Rossi, R. A., Yoon, S., Schutze, H. (7 authors, Adobe) (2025). "NoLiMa: Long-Context Evaluation Beyond Literal Matching." ICML 2025. <https://arxiv.org/abs/2502.05167> | Degradation is worst beyond literal matching - item matching uses paraphrase-tolerant token overlap, not exact strings. |
| Normative: Federal Aviation Administration. Aeronautical Information Manual, para 4-4-7 "ATC Clearance/Instruction Readback". <https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_4.html> | Aviation institutionalized readback as mutual verification against misheard or incorrect items - the craft protocol transplants that discipline to phone agents. |

## Verification notes and corrections

- All four URLs were verified against their live source pages on
  2026-10-19 during authoring.
- SummHay is an EMNLP 2024 MAIN conference paper
  (2024.emnlp-main.552); some indexes miscite a findings URL.
- NoLiMa is arXiv 2502.05167 (not 2503.xxxx as some aggregators list).
- The FAA readback guidance sits under AIM para 4-4-7 "Pilot
  Responsibility upon Clearance Issuance" (ATC
  Clearance/Instruction Readback).
- ICAO Doc 9432 was considered and rejected as a citation: paywalled,
  no live public URL.
- The chunk/match heuristics in this skill are NOT validated
  instruments; the cited papers' benchmark results do not transfer to
  them.
