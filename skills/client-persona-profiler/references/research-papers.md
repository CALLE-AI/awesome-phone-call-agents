# Research Papers — client-persona-profiler

This skill is grounded in the research below. Every citation has been checked
to exist; no unverified references are included.

---

## 1. Behavioural Archetype Classification

### DISC — *Emotions of Normal People* (Marston, 1928)
- **Relevance**: Origin of the four-quadrant behavioural model
  (Dominant, Influential, Steady, Conscientious) that the keyword marker
  library in `profile_caller.py` is adapted from.

**Honest limitation**: DISC's predictive validity is contested in independent
academic literature; much of the supporting research is published by DISC
assessment vendors (e.g. Target Training International's research arm). This
skill therefore treats DISC archetypes as **advisory communication-style
hints**, never as validated psychometric measurements, and abstains
(`Undetermined`) when the signal margin is narrow. See
[`safety.md`](safety.md) for the full usage constraints.

### Persona-DB: Efficient Large Language Model Personalization for Response Prediction with Collaborative Data Refinement
- **Identifier**: arXiv:2402.11060 (published at COLING 2025)
- **Authors**: Chenkai Sun, Ke Yang, Revanth Gangi Reddy, Yi R. Fung,
  Hou Pong Chan, Kevin Small, ChengXiang Zhai, Heng Ji
- **Relevance**: Shows persona profiles can be maintained and retrieved
  without fine-tuning. Conceptual basis for the per-caller JSONL profile
  store used by this skill.

---

## 2. Loyalty Scoring

### Classic RFM (Recency-Frequency-Monetary) model
- **Relevance**: Long-established database-marketing scoring model. The
  `compute_rfmap()` function is an RFMAP-style adaptation (Recency,
  Frequency, plus an activation-period spread term). The weights
  (0.45 / 0.35 / 0.20) are a skill design choice, not empirically derived.

### Predicting Customer Satisfaction by Replicating the Survey Response Distribution
- **Identifier**: arXiv:2411.12539 (2024)
- **Relevance**: Predicts CSAT from call transcripts without surveys.
  Conceptual basis for using transcript sentiment trajectory as a
  satisfaction/loyalty proxy.
