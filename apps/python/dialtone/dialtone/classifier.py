"""Counterpart classifier: human / ivr / agent.

Two paths, reported separately in the eval so neither hides the other:
  protocol - the counterpart acknowledged the DIALTONE handshake (cooperative agents).
  model    - multinomial logistic regression over features.FEATURE_NAMES
             (uncooperative agents, IVRs, humans).

The model is deliberately small and linear so every decision can be explained
by its top feature contributions. It is trained on *prefixes* of transcripts so
it can commit early, and it abstains ("unknown") until it has heard the
counterpart speak.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

from . import features, protocol
from .models import LABELS, Transcript

MODEL_PATH = Path(__file__).with_name("model.json")
TRAIN_WINDOWS = (3.0, 5.0, 8.0, 15.0, None)
TIMELINE = (1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 45, 60, None)


@dataclass
class Detection:
    label: str  # human | ivr | agent | unknown
    confidence: float
    probs: dict[str, float]
    via: str  # protocol | model | abstain
    at_seconds: float | None = None
    top_features: list[tuple[str, float]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "confidence": round(self.confidence, 3),
            "probs": {k: round(v, 3) for k, v in self.probs.items()},
            "via": self.via,
            "at_seconds": self.at_seconds,
            "top_features": [(n, round(c, 3)) for n, c in self.top_features],
        }


def _softmax(z: list[float]) -> list[float]:
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return [v / s for v in e]


class Classifier:
    def __init__(self, weights=None, bias=None, mean=None, std=None, meta=None, active=None):
        k, d = len(LABELS), len(features.FEATURE_NAMES)
        self.W = weights or [[0.0] * d for _ in range(k)]
        self.b = bias or [0.0] * k
        self.mean = mean or [0.0] * d
        self.std = std or [1.0] * d
        self.meta = meta or {}
        # Feature subset used for ablations; inactive features are pinned to the training mean.
        self.active = list(active) if active else list(features.FEATURE_NAMES)

    # -- training ----------------------------------------------------------
    def fit(self, transcripts: list[Transcript], epochs: int = 400, lr: float = 0.2, l2: float = 0.01, seed: int = 7):
        X, y = [], []
        for t in transcripts:
            for w in TRAIN_WINDOWS:
                part = t.window(w)
                if part.user_turns():
                    X.append(features.vector(part))
                    y.append(LABELS.index(t.label))
        d = len(features.FEATURE_NAMES)
        self.mean = [sum(r[j] for r in X) / len(X) for j in range(d)]
        self.std = [max(1e-3, math.sqrt(sum((r[j] - self.mean[j]) ** 2 for r in X) / len(X))) for j in range(d)]
        Xs = [self._scale(r) for r in X]
        rng = random.Random(seed)
        idx = list(range(len(Xs)))
        for _ in range(epochs):
            rng.shuffle(idx)
            gW = [[0.0] * d for _ in LABELS]
            gb = [0.0] * len(LABELS)
            for i in idx:
                p = _softmax([sum(wj * xj for wj, xj in zip(self.W[c], Xs[i])) + self.b[c] for c in range(len(LABELS))])
                for c in range(len(LABELS)):
                    err = p[c] - (1.0 if y[i] == c else 0.0)
                    gb[c] += err
                    for j in range(d):
                        gW[c][j] += err * Xs[i][j]
            n = len(Xs)
            for c in range(len(LABELS)):
                self.b[c] -= lr * gb[c] / n
                for j in range(d):
                    self.W[c][j] -= lr * (gW[c][j] / n + l2 * self.W[c][j])
        self.meta = {"n_transcripts": len(transcripts), "n_training_rows": len(Xs), "windows": [w for w in TRAIN_WINDOWS]}
        return self

    def _scale(self, row: list[float]) -> list[float]:
        return [
            (v - m) / s if name in self.active else 0.0
            for name, v, m, s in zip(features.FEATURE_NAMES, row, self.mean, self.std)
        ]

    # -- inference ---------------------------------------------------------
    def predict_proba(self, t: Transcript) -> tuple[dict[str, float], list[tuple[str, float]]]:
        x = self._scale(features.vector(t))
        z = [sum(wj * xj for wj, xj in zip(self.W[c], x)) + self.b[c] for c in range(len(LABELS))]
        p = _softmax(z)
        top = max(range(len(LABELS)), key=lambda c: p[c])
        contrib = sorted(
            ((name, self.W[top][j] * x[j]) for j, name in enumerate(features.FEATURE_NAMES)),
            key=lambda kv: -abs(kv[1]),
        )[:4]
        return dict(zip(LABELS, p)), contrib

    def classify(self, t: Transcript, until: float | None = None, use_protocol: bool = True, nonce: str | None = None) -> Detection:
        part = t.window(until)
        if use_protocol:
            hs = protocol.inspect(part, nonce)
            if hs.verified:
                probs = {"human": 0.005, "ivr": 0.005, "agent": 0.99}
                return Detection("agent", 0.99, probs, "protocol", hs.acknowledged_at, [("handshake_ack", 1.0)])
        if not part.user_turns():
            return Detection("unknown", 0.0, {k: 1 / 3 for k in LABELS}, "abstain", until)
        probs, contrib = self.predict_proba(part)
        label = max(probs, key=probs.get)
        return Detection(label, probs[label], probs, "model", until, contrib)

    def timeline(self, t: Transcript, threshold: float = 0.8, use_protocol: bool = True, nonce: str | None = None):
        """Classify at growing windows; return (points, time_to_detection).

        time_to_detection is the first window after which the final label is
        held with >= threshold confidence at every later window - i.e. when a
        live system could have committed without ever flip-flopping.
        """
        points = []
        for w in TIMELINE:
            if w is not None and w > t.duration + 1:
                continue
            det = self.classify(t, w, use_protocol, nonce)
            points.append((w if w is not None else round(t.duration, 1), det))
        final = points[-1][1].label
        ttd = None
        for i, (w, _) in enumerate(points):
            if all(d.label == final and d.confidence >= threshold for _, d in points[i:]):
                ttd = w
                break
        return points, ttd

    # -- persistence -------------------------------------------------------
    def save(self, path: Path = MODEL_PATH):
        path.write_text(json.dumps({
            "labels": list(LABELS),
            "features": features.FEATURE_NAMES,
            "weights": [[round(v, 5) for v in row] for row in self.W],
            "bias": [round(v, 5) for v in self.b],
            "mean": [round(v, 5) for v in self.mean],
            "std": [round(v, 5) for v in self.std],
            "active": self.active,
            "meta": self.meta,
        }, indent=2))

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "Classifier":
        d = json.loads(Path(path).read_text())
        if d["features"] != features.FEATURE_NAMES:
            raise ValueError("model.json was trained on a different feature set; run `dialtone train`")
        return cls(d["weights"], d["bias"], d["mean"], d["std"], d.get("meta"), d.get("active"))
