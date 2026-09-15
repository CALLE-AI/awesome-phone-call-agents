# Research Papers — client-persona-profiler

This skill is grounded in the following peer-reviewed and industry research.

---

## 1. Persona Representation & Storage

### Persona-DB: Efficient Large Language Model Personalization for Response Prediction with Collaborative Data Refinement
- **Authors**: Salemi et al.
- **Identifier**: arXiv:2402.11060
- **Year**: 2024
- **Relevance**: Directly informs the profile storage and retrieval design. Demonstrates
  that persona profiles can be maintained and retrieved efficiently without
  full model fine-tuning, using collaborative data refinement. Applied here as
  the conceptual basis for the JSONL-per-caller profile store.

### PersonaBOT: Generative AI for Persona Creation and Customer Service Augmentation
- **Source**: arXiv, 2024
- **Relevance**: Shows that LLMs can generate synthetic customer personas for use in
  RAG-based chatbots. Informs the LLM-assisted persona enrichment path
  (when `OPENAI_API_KEY` is configured).

---

## 2. Behavioural Archetype Classification

### DISC Behavioural Model
- **Original Author**: William Moulton Marston, *Emotions of Normal People*, 1928
- **Validation**: Bonnstetter, B.J., et al., "Validity Studies on the DISC Assessment,"
  Target Training International, 2009
- **Relevance**: Provides the four-quadrant personality classification framework
  (Dominant, Influential, Steady, Conscientious) used for archetype scoring.
  Linguistic marker mapping adapted from DISC validation research.

### Big Five Personality Recognition from Voice Conversations in Call-Centre Interactions
- **Source**: ResearchGate / MDPI, 2023
- **Relevance**: Demonstrates that personality traits (Big Five: Openness,
  Conscientiousness, Extraversion, Agreeableness, Neuroticism) can be inferred
  from conversational transcripts in call-centre settings. Confirms the
  feasibility of transcript-based personality classification.

---

## 3. Loyalty Scoring

### RFMAP Model: Extending RFM with Activation Periods and Activation Loyalty
- **Source**: ResearchGate, 2024
- **Relevance**: Proposes the RFMAP extension (Recency, Frequency, Monetary,
  Activation Periods, Activation Loyalty) to the classic RFM model for more
  accurate customer loyalty and churn prediction. The RFMAP computation in
  `profile_caller.py` is a simplified adaptation.

### Machine Learning for Customer Loyalty Prediction in Contact Centres
- **Source**: Mosaic Data Science / RSIS International, 2024
- **Relevance**: Reviews Random Forest, Logistic Regression, and LLM-based
  approaches for loyalty prediction from call data. Confirms the value of
  combining frequency-based metrics with conversational signals.

---

## 4. Call Driver & Intent Extraction

### LLM-Based Call Driver Generation for Contact Centre Analytics
- **Source**: arXiv, 2024 (Cost-Efficient LLM Design for Contact Centres)
- **Relevance**: Demonstrates automated extraction of primary call intent ("call driver")
  from transcripts using LLMs, replacing brittle keyword-rule systems.
  Informs the `call_driver` field in the persona card output.

### Predicting Customer Satisfaction (CSAT) from Transcripts
- **Identifier**: arXiv:2411.12539
- **Year**: November 2024
- **Relevance**: Introduces a method for predicting CSAT scores for calls where no
  post-call survey was completed. Provides the conceptual basis for using
  transcript sentiment trajectory as a loyalty proxy.

---

## 5. Personalization at Scale

### Socially-Grounded Persona Framework (SCOPE)
- **Source**: arXiv, 2024
- **Relevance**: Proposes socially-grounded persona representations that include
  demographic, cultural, and behavioural signals. Informs the multi-signal
  approach to persona classification beyond simple keyword matching.
