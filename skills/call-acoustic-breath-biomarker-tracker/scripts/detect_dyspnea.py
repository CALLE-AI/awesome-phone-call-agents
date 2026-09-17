import math

class DyspneaDetector:
    def __init__(self, pause_threshold_ratio: float = 0.4):
        """
        Initializes the dyspnea detector.
        :param pause_threshold_ratio: The threshold ratio of pause time to total speech time.
                                      Values above this may indicate dyspnea.
        """
        self.pause_threshold_ratio = pause_threshold_ratio

    def analyze_acoustic_segments(self, segments: list) -> bool:
        """
        Analyzes a list of speech/pause segments to detect dyspnea.
        :param segments: List of dicts, e.g., [{"type": "speech", "duration_ms": 1500}, {"type": "pause", "duration_ms": 1000}]
        :return: True if dyspnea is detected, False otherwise.
        """
        total_speech_ms = 0
        total_pause_ms = 0
        
        for segment in segments:
            if segment.get("type") == "speech":
                total_speech_ms += segment.get("duration_ms", 0)
            elif segment.get("type") == "pause":
                total_pause_ms += segment.get("duration_ms", 0)
                
        if total_speech_ms == 0:
            return False # Avoid division by zero
            
        ratio = total_pause_ms / (total_speech_ms + total_pause_ms)
        return ratio >= self.pause_threshold_ratio

    def process_call_stream(self, phone_number: str, segments: list) -> dict:
        """
        Main entry point for processing the call stream.
        Strictly respects compliance regarding the phone number.
        """
        if not phone_number.startswith("555-01"):
            raise ValueError("Compliance Error: Real phone numbers are prohibited. Use 555-01xx range.")
            
        is_dyspnea = self.analyze_acoustic_segments(segments)
        
        return {
            "phone_number": phone_number,
            "status": "escalate" if is_dyspnea else "continue",
            "clinical_flag": "dyspnea_detected" if is_dyspnea else "normal"
        }
