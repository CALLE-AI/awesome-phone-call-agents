"""
call-acoustic-breath-biomarker-tracker

Offline nonclinical pause-ratio demonstration over supplied synthetic segments.
Legacy clinical-sounding enums are illustrative labels, not medical findings.
No audio capture, diagnosis, patient triage, or emergency handoff is implemented.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List


class Action(str, Enum):
    ESCALATE_TO_HUMAN = "ESCALATE_TO_HUMAN"
    PROCEED_NORMALLY = "PROCEED_NORMALLY"
    INDETERMINATE = "INDETERMINATE"


class ClinicalFlag(str, Enum):
    DYSPNEA_DETECTED = "DYSPNEA_DETECTED"
    NORMAL = "NORMAL"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass
class AudioSegment:
    type: str  # "speech" or "pause"
    duration_ms: int

    def __post_init__(self):
        if self.duration_ms < 0:
            raise ValueError("Segment duration cannot be negative")
        if self.type not in {"speech", "pause"}:
            raise ValueError(f"Unknown segment type: {self.type}")


@dataclass
class DyspneaResult:
    caller_number: str
    pause_ratio: float
    clinical_flag: ClinicalFlag
    recommended_action: Action


class DyspneaDetector:
    def __init__(self, pause_threshold_ratio: float = 0.40):
        """
        Initializes the dyspnea detector.
        :param pause_threshold_ratio: The threshold ratio of pause time to total speech time.
                                      Values above this may indicate dyspnea.
        """
        if not (0.0 <= pause_threshold_ratio <= 1.0):
            raise ValueError("Threshold ratio must be in [0.0, 1.0]")
        self.pause_threshold_ratio = pause_threshold_ratio

    def analyze_acoustic_segments(self, segments: List[AudioSegment]) -> float:
        """
        Analyzes a list of speech/pause segments to compute the pause-to-total ratio.
        """
        total_speech_ms = 0
        total_pause_ms = 0
        
        for segment in segments:
            if segment.type == "speech":
                total_speech_ms += segment.duration_ms
            elif segment.type == "pause":
                total_pause_ms += segment.duration_ms
                
        total_time = total_speech_ms + total_pause_ms
        if total_time == 0:
            return -1.0 # Indicator for no data
            
        ratio = total_pause_ms / total_time
        return ratio

    def process_call_stream(self, caller_number: str, segments: List[AudioSegment]) -> DyspneaResult:
        """
        Main entry point for processing the call stream.
        Strictly respects compliance regarding the phone number.
        """
        if not caller_number.startswith("555-01"):
            raise ValueError(
                f"Compliance violation: caller_number '{caller_number}' must use the "
                "555-01xx test number format. Real phone numbers are prohibited."
            )
            
        ratio = self.analyze_acoustic_segments(segments)
        
        if ratio < 0:
            return DyspneaResult(
                caller_number=caller_number,
                pause_ratio=0.0,
                clinical_flag=ClinicalFlag.INSUFFICIENT_DATA,
                recommended_action=Action.INDETERMINATE
            )
            
        is_dyspnea = ratio >= self.pause_threshold_ratio
        
        return DyspneaResult(
            caller_number=caller_number,
            pause_ratio=round(ratio, 4),
            clinical_flag=ClinicalFlag.DYSPNEA_DETECTED if is_dyspnea else ClinicalFlag.NORMAL,
            recommended_action=Action.ESCALATE_TO_HUMAN if is_dyspnea else Action.PROCEED_NORMALLY
        )
