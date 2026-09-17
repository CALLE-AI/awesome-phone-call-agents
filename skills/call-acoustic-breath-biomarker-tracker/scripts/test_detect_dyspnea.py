import pytest
from detect_dyspnea import DyspneaDetector, AudioSegment, ClinicalFlag, Action

def test_dyspnea_detection_normal():
    detector = DyspneaDetector()
    segments = [
        AudioSegment(type="speech", duration_ms=4000),
        AudioSegment(type="pause", duration_ms=500),
        AudioSegment(type="speech", duration_ms=3000)
    ]
    result = detector.process_call_stream("555-0199", segments)
    assert result.clinical_flag == ClinicalFlag.NORMAL
    assert result.recommended_action == Action.PROCEED_NORMALLY

def test_dyspnea_detection_abnormal():
    detector = DyspneaDetector(pause_threshold_ratio=0.4)
    segments = [
        AudioSegment(type="speech", duration_ms=1000),
        AudioSegment(type="pause", duration_ms=1200),
        AudioSegment(type="speech", duration_ms=800),
        AudioSegment(type="pause", duration_ms=1500)
    ]
    result = detector.process_call_stream("555-0100", segments)
    assert result.clinical_flag == ClinicalFlag.DYSPNEA_DETECTED
    assert result.recommended_action == Action.ESCALATE_TO_HUMAN

def test_process_call_stream_empty_segments():
    detector = DyspneaDetector()
    result = detector.process_call_stream("555-0101", [])
    assert result.clinical_flag == ClinicalFlag.INSUFFICIENT_DATA
    assert result.recommended_action == Action.INDETERMINATE

def test_process_call_stream_compliance():
    detector = DyspneaDetector()
    segments = [AudioSegment(type="speech", duration_ms=4000)]
    
    # Must accept valid test number
    result = detector.process_call_stream("555-0199", segments)
    assert result.clinical_flag == ClinicalFlag.NORMAL
    
    # Must reject non-compliant number
    with pytest.raises(ValueError, match="555-01xx"):
        detector.process_call_stream("123-4567", segments)

def test_negative_duration_raises_error():
    with pytest.raises(ValueError, match="cannot be negative"):
        AudioSegment(type="speech", duration_ms=-100)

def test_invalid_type_raises_error():
    with pytest.raises(ValueError, match="Unknown segment type"):
        AudioSegment(type="yelling", duration_ms=100)

def test_invalid_threshold_ratio():
    with pytest.raises(ValueError, match="Threshold ratio must be in"):
        DyspneaDetector(pause_threshold_ratio=1.5)
