# Research Scope — call-synthetic-counterparty-detector

This demonstration scores supplied latency, duration and word-pattern features.
It does not analyze raw audio or implement phoneme-discretized saliency maps
(PDSM). Its arbitrary thresholds are not calibrated identity probabilities.

No published model reproduction, TTS benchmark, detection accuracy or regulatory
compliance is established by this implementation. The original paper-to-code
attributions must not be read as validation of these coarse heuristics.

The [NIST AI Risk Management Framework](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf)
is general risk-management background, not certification of this detector.
No identity decision, security bypass or protocol switch should be automated
from its advisory output; no M2M transport is implemented here.
