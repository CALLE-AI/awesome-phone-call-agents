"""
Classifies a sign from landmark features. `classify_features` is what the live
stream in app.py calls per segmented sign; the command line runs the same model
on a video file, which is handy for trying a clip without the browser:

    python infer.py --video path/to/clip.mp4 --topk 5
"""
import argparse
import json
from functools import lru_cache

import cv2
import numpy as np
import torch

from models import BiGRUAttention
from utils_landmarks import FEATURE_DIM, Landmarkers, sample_or_pad

SEQ_LEN = 32  # frames per clip after resampling; must match training
DEFAULT_CHECKPOINT = "model_gru_best.pt"
DEFAULT_LABEL_MAP = "label_map.json"


def load_label_map(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def extract_features_from_video(path: str) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    feats = []
    with Landmarkers() as landmarkers:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            feats.append(landmarkers.process_frame(rgb))
    cap.release()
    if not feats:
        raise ValueError(f"No frames could be read from {path}")
    return np.stack(feats)


@lru_cache(maxsize=2)
def _load_cached(checkpoint: str, label_map_path: str):
    """Loaded once and reused, so a live stream doesn't reread the weights per sign."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    label_to_idx = load_label_map(label_map_path)
    idx_to_label = {v: k for k, v in label_to_idx.items()}
    model = BiGRUAttention(FEATURE_DIM, len(label_to_idx))
    model.load_state_dict(torch.load(checkpoint, map_location=device))
    model.to(device).eval()
    return model, idx_to_label, device


def classify_features(feats: np.ndarray, checkpoint: str = DEFAULT_CHECKPOINT,
                      label_map_path: str = DEFAULT_LABEL_MAP, topk: int = 3):
    """Top-k (label, probability) pairs for one (T, FEATURE_DIM) landmark sequence."""
    model, idx_to_label, device = _load_cached(checkpoint, label_map_path)

    feats = sample_or_pad(feats, SEQ_LEN)
    x = torch.from_numpy(feats).float().unsqueeze(0).to(device)  # (1, T, D)

    with torch.no_grad():
        probs = torch.softmax(model(x), dim=1).squeeze(0)

    top_probs, top_idx = probs.topk(min(topk, len(idx_to_label)))
    return [(idx_to_label[i.item()], p.item()) for p, i in zip(top_probs, top_idx)]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    ap.add_argument("--topk", type=int, default=3)
    args = ap.parse_args()

    results = classify_features(extract_features_from_video(args.video),
                                checkpoint=args.checkpoint, topk=args.topk)
    print("\nTop predictions:")
    for word, prob in results:
        print(f"  {word:15s} {prob:.3f}")
