# Research Papers — call-fraud-shield

This skill is grounded in the following peer-reviewed and benchmark research.

---

## 1. Real-Time Vishing Detection

### "It Warned Me Just at the Right Moment": Exploring LLM-Based Real-Time Vishing Detection
- **Source**: arXiv, 2025
- **Relevance**: Foundational framework for LLM-based real-time vishing detection.
  Demonstrates that trajectory analysis (tracking how a conversation escalates)
  significantly outperforms single-turn classifiers. Directly informs the
  `build_trajectory()` function and harm-projection logic in `detect_fraud.py`.

### Vishing-Tactics-Bench: A Benchmark for Situation-Aware Vishing Defence
- **Source**: arXiv, 2026
- **Relevance**: Recasts vishing detection as a situation-awareness and forecasting
  problem — predicting where a conversation is heading, not just what was said.
  Informs the `trajectory_assessment` and `harm_projection` fields in the
  risk card output.

---

## 2. Adversarial Robustness

### Talking Like a Phisher: Adversarial Transcripts for Vishing Classifier Evasion
- **Identifier**: arXiv:2507.16291
- **Year**: 2025
- **Relevance**: Demonstrates that LLM-generated adversarial transcripts reduce the
  accuracy of traditional ML classifiers (keyword, SVM, BERT) by up to 30.96%.
  **This is the primary justification for using an LLM-based trajectory detector
  rather than a keyword or ML classifier.** The heuristic fallback in this skill
  is explicitly marked `analysis_mode: "heuristic"` to signal reduced confidence.

---

## 3. LLM-Based Vishing Scoring

### VishGPT: Reinforcement Learning Fine-Tuned LLM for Real-Time Vishing Detection
- **Source**: University of Minnesota, 2025
- **Relevance**: Reference architecture for the LLM-based threat scoring module.
  VishGPT demonstrates high F1 scores for vishing classification using RL
  fine-tuning on conversational data. Informs the LLM prompt design for the
  optional LLM scoring path (when `OPENAI_API_KEY` is configured).

### Fine-Tuned Small Language Models (SLM) for Vishing Detection
- **Source**: Sim & Kim, MDPI, 2024/2025
- **Relevance**: Shows that fine-tuned smaller models can provide high-precision
  detection as an alternative to large, expensive LLMs. Supports the
  heuristic fallback design philosophy: the skill degrades gracefully without
  an LLM rather than refusing to run.

---

## 4. Deepfake Voice Detection

### Hybrid CNN-RNN Architecture for Voice Fraud and Deepfake Detection
- **Source**: Atlantis Press / IJSRED, 2024
- **Relevance**: Documents MFCC-based (Mel-Frequency Cepstral Coefficients) acoustic
  anomaly detection for identifying synthetic or AI-generated voices. Informs
  the `deepfake_voice_probability` field and the `--audio-features` optional
  input path in `detect_fraud.py`.

### SiFSafer: Prioritising Human Voice Feature Learning for Robust Audio Deepfake Detection
- **Source**: songli.io / arXiv, 2024
- **Relevance**: Framework for making deepfake detection models more robust to
  sophisticated AI-generated spoofing by prioritising genuine human voice
  features over superficial artefacts. Informs the design philosophy for
  the acoustic analysis module.

---

## 5. Explainability (XAI)

### Explainable AI (XAI) in Telecommunication Fraud Detection
- **Source**: Semantic Scholar, 2024
- **Relevance**: Demonstrates the importance of embedding human-readable explanations
  (XAI) in fraud detection systems to increase trust, auditability, and
  actionability. Directly motivates the `xai_explanation` and `trigger_signals`
  evidence-span fields in the risk card. Systems without explanations have
  lower adoption in high-stakes operational contexts.

---

## 6. Transformer-Based Classification

### BERT-Based Scam Transcript Classification
- **Source**: ACL Anthology / openreview.net, 2024
- **Relevance**: Demonstrates transformer-based intent classification on vishing
  transcripts, providing baseline performance benchmarks for LLM-based
  approaches. Informs the LLM prompt structure for threat category classification.

---

## 7. Multimodal Approaches

### Multimodal Fraud Detection Integrating Text and Acoustic Features
- **Source**: Atlantis Press / ResearchGate, 2024
- **Relevance**: Shows that combining linguistic/semantic signals with acoustic
  features (MFCC, prosody) significantly improves fraud detection accuracy.
  Motivates the optional `--audio-features` input path and the two-layer
  design (linguistic signals + acoustic signals) of `detect_fraud.py`.
