# Research Papers — call-fraud-shield

This skill is grounded in the following peer-reviewed and benchmark research.
Every citation below has been checked to exist; no unverified references are
included.

---

## 1. Real-Time Vishing Detection

### "It Warned Me Just at the Right Moment": Exploring LLM-based Real-time Detection of Phone Scams
- **Identifier**: arXiv:2502.03964 (also published at CHI EA 2025)
- **Authors**: Shen, Zhang, Ngai, Fu (The Hong Kong Polytechnic University)
- **Relevance**: Models scam calls as evolving conversations and detects
  fraudulent intent during the call rather than after the fact. Motivates the
  trajectory-over-single-turn design of `build_trajectory()` in
  `detect_fraud.py`.

### Vishing-Tactics-Bench: Forecasting Exploitation Trajectories in Voice Phishing Calls
- **Identifier**: arXiv:2609.07151 (2026)
- **Relevance**: Recasts vishing detection as a situation-awareness and
  forecasting problem — predicting where a conversation is heading, not just
  what was said. Informs the `trajectory_assessment` and `harm_projection`
  fields in the risk card output.

---

## 2. Adversarial Robustness

### Talking Like a Phisher: LLM-Based Attacks on Voice Phishing Classifiers
- **Identifier**: arXiv:2507.16291 (2025)
- **Relevance**: Shows that LLM-generated adversarial transcripts reduce the
  accuracy of traditional keyword and ML vishing classifiers. This skill does
  **not** claim to solve that problem — the shipped heuristic is still
  pattern-based — which is exactly why every output is labelled
  `analysis_mode: "heuristic"` and why the risk card is advisory only.

---

## 3. Model-Assisted Detection (Reference Architecture)

### Automatically Detecting Voice Phishing: A Large Audio Model Approach (VishGPT)
- **Source**: MIS Quarterly (University of Minnesota), 2025
- **Relevance**: Reference architecture for a possible future model-assisted
  extension: a large audio model with reinforcement-learning fine-tuning and
  targeted synthetic-data generation for real-time vishing detection. The
  current skill makes no model call; this citation documents the direction a
  future extension could take.
