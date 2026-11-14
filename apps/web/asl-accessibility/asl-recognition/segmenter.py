"""
Splits a continuous stream of per-frame feature vectors into one segment per
sign, so a user can sign word after word without pressing a button each time.

This is segmentation, not continuous sign-language recognition. A segment is
the run of frames from when a hand appears until no hand has been visible for
ABSENT_FRAMES_FOR_BOUNDARY frames, and each segment is classified on its own
by the isolated-word model. Hand presence is used rather than motion because
the training clips are dictionary-style (hands enter, sign, leave), and because
motion thresholds miss signs that are mostly a held handshape, such as
fingerspelled letters.

The thresholds were chosen for a ~7-10 fps capture rate and have not been tuned
across signers or cameras. Words split in two: raise ABSENT_FRAMES_FOR_BOUNDARY.
Two signs merged into one: lower it.
"""
import numpy as np

ABSENT_FRAMES_FOR_BOUNDARY = 8   # consecutive no-hand frames that end a sign
MIN_SEGMENT_FRAMES = 5           # shorter segments are discarded as noise
MAX_SEGMENT_FRAMES = 150         # cap so a stuck-open hand cannot buffer forever
TAIL_TRIM_FRAMES = 2             # trailing frames dropped from each segment
LEFT_PRESENT_IDX, RIGHT_PRESENT_IDX = 225, 226


def _hands_present(feat: np.ndarray) -> bool:
    return feat[LEFT_PRESENT_IDX] > 0.5 or feat[RIGHT_PRESENT_IDX] > 0.5


class SignSegmenter:
    """One instance per camera session. add_frame() returns a stacked
    (T, FEATURE_DIM) array when a sign has just ended, otherwise None."""

    def __init__(self):
        self.buffer = []
        self.absent_count = 0

    def add_frame(self, feat: np.ndarray):
        present = _hands_present(feat)

        if present:
            self.absent_count = 0
            self.buffer.append(feat)
        elif self.buffer:
            # hands gone mid-sign: keep buffering in case it is only a dropout
            self.absent_count += 1
            self.buffer.append(feat)
            if self.absent_count >= ABSENT_FRAMES_FOR_BOUNDARY:
                return self._flush()

        if len(self.buffer) >= MAX_SEGMENT_FRAMES:
            return self._flush()
        return None

    def _flush(self):
        segment = self.buffer
        self.buffer = []
        self.absent_count = 0

        last_present = -1
        for i, f in enumerate(segment):
            if _hands_present(f):
                last_present = i
        segment = segment[: last_present + 1]

        trim = min(TAIL_TRIM_FRAMES, max(0, len(segment) - MIN_SEGMENT_FRAMES))
        if trim > 0:
            segment = segment[:-trim]

        if len(segment) < MIN_SEGMENT_FRAMES:
            return None
        return np.stack(segment)

    def is_active(self) -> bool:
        """True while a sign is being buffered; drives the UI's signing indicator."""
        return len(self.buffer) > 0
