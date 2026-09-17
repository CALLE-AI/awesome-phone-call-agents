import pytest
from detect_dyspnea import DyspneaDetector

def test_dyspnea_detection_normal():
    detector = DyspneaDetector()
    segments = [
        {"type": "speech", "duration_ms": 4000},
        {"type": "pause", "duration_ms": 500},
        {"type": "speech", "duration_ms": 3000}
    ]
    # Total pause = 500, Total = 7500, ratio = 500/7500 = 0.066 < 0.4
    assert detector.analyze_acoustic_segments(segments) is False

def test_dyspnea_detection_abnormal():
    detector = DyspneaDetector(pause_threshold_ratio=0.4)
    segments = [
        {"type": "speech", "duration_ms": 1000},
        {"type": "pause", "duration_ms": 1200},
        {"type": "speech", "duration_ms": 800},
        {"type": "pause", "duration_ms": 1500}
    ]
    # Total pause = 2700, Total speech = 1800. Ratio = 2700 / 4500 = 0.6 >= 0.4
    assert detector.analyze_acoustic_segments(segments) is True

def test_process_call_stream_compliance():
    detector = DyspneaDetector()
    segments = [{"type": "speech", "duration_ms": 4000}]
    
    # Must accept valid test number
    result = detector.process_call_stream("555-0199", segments)
    assert result["clinical_flag"] == "normal"
    
    # Must reject non-compliant number
    with pytest.raises(ValueError):
        detector.process_call_stream("123-4567", segments)
