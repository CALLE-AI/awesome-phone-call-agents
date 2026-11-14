"""
Per-frame landmark extraction and normalisation (MediaPipe Tasks API:
HandLandmarker + PoseLandmarker). The same code produced the training features
and produces the live ones, so the two always match.

Feature vector per frame (227 dims):
  [0:99]    pose landmarks (33 x xyz)
  [99:162]  left hand landmarks (21 x xyz)
  [162:225] right hand landmarks (21 x xyz)
  [225]     left_hand_present (0/1)
  [226]     right_hand_present (0/1)

Coordinates are translated to the midpoint of the shoulders and scaled by
shoulder width, so features are roughly invariant to the signer's distance and
position. Hands use the same shoulder origin (not their own wrist), which keeps
hand position relative to the body, part of the meaning of many signs.
"""
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

N_POSE, N_HAND = 33, 21
FEATURE_DIM = N_POSE * 3 + N_HAND * 3 + N_HAND * 3 + 2  # 227

LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12

DEFAULT_HAND_MODEL = "models/hand_landmarker.task"
DEFAULT_POSE_MODEL = "models/pose_landmarker.task"


class Landmarkers:
    """One HandLandmarker and one PoseLandmarker in VIDEO mode. Reuse an
    instance across frames: loading is slow, and VIDEO mode only needs a
    strictly increasing timestamp, which is tracked internally."""

    def __init__(self, hand_model_path: str = DEFAULT_HAND_MODEL,
                 pose_model_path: str = DEFAULT_POSE_MODEL):
        self.hand = mp_vision.HandLandmarker.create_from_options(
            mp_vision.HandLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=hand_model_path),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_hands=2,
            )
        )
        self.pose = mp_vision.PoseLandmarker.create_from_options(
            mp_vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=pose_model_path),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_poses=1,
            )
        )
        self._ts_ms = 0

    def process_frame(self, rgb_frame: np.ndarray) -> np.ndarray:
        """rgb_frame: HxWx3 uint8, RGB order (cv2 reads BGR -- convert first)."""
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        self._ts_ms += 1  # only needs to strictly increase call over call
        hand_result = self.hand.detect_for_video(mp_image, self._ts_ms)
        pose_result = self.pose.detect_for_video(mp_image, self._ts_ms)
        return extract_frame_features(hand_result, pose_result)

    def close(self):
        self.hand.close()
        self.pose.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _landmarks_to_array(landmarks_list, n_points):
    if not landmarks_list:
        return np.zeros((n_points, 3), dtype=np.float32)
    return np.array([[lm.x, lm.y, lm.z] for lm in landmarks_list], dtype=np.float32)


def extract_frame_features(hand_result, pose_result) -> np.ndarray:
    """One frame's hand and pose results as a normalised flat feature vector."""
    pose_lms = pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None
    pose = _landmarks_to_array(pose_lms, N_POSE)

    left_lms, right_lms = None, None
    for lms, handedness in zip(hand_result.hand_landmarks, hand_result.handedness):
        label = handedness[0].category_name  # "Left" or "Right"
        if label == "Left":
            left_lms = lms
        else:
            right_lms = lms

    left_hand = _landmarks_to_array(left_lms, N_HAND)
    right_hand = _landmarks_to_array(right_lms, N_HAND)
    left_present = float(left_lms is not None)
    right_present = float(right_lms is not None)

    if pose_lms is not None:
        origin = (pose[LEFT_SHOULDER] + pose[RIGHT_SHOULDER]) / 2.0
        scale = np.linalg.norm(pose[LEFT_SHOULDER] - pose[RIGHT_SHOULDER])
        scale = scale if scale > 1e-6 else 1.0
    else:
        origin = np.zeros(3, dtype=np.float32)
        scale = 1.0

    pose_n = (pose - origin) / scale
    left_n = (left_hand - origin) / scale
    right_n = (right_hand - origin) / scale

    # an undetected hand must read as zeros, not as the shoulder origin
    left_n = left_n if left_present else np.zeros_like(left_n)
    right_n = right_n if right_present else np.zeros_like(right_n)

    feat = np.concatenate([
        pose_n.flatten(), left_n.flatten(), right_n.flatten(),
        [left_present, right_present],
    ]).astype(np.float32)
    return feat


def sample_or_pad(sequence: np.ndarray, target_len: int) -> np.ndarray:
    """Uniformly resample a (T, D) sequence to exactly target_len frames
    (short clips repeat frames, long ones drop them), so no padding mask is needed."""
    t = sequence.shape[0]
    if t == 0:
        return np.zeros((target_len, sequence.shape[1] if sequence.ndim > 1 else FEATURE_DIM), dtype=np.float32)
    idx = np.linspace(0, t - 1, target_len).round().astype(int)
    return sequence[idx]
