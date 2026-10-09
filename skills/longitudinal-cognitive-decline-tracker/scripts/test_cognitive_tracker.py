import pytest
from cognitive_tracker import analyze_longitudinal_biomarkers, ClinicalStatus

def test_stable_patient():
    history = [
        {"timestamp": 1, "caller": "+1-555-0101", "avg_pause_ms": 400},
        {"timestamp": 2, "caller": "+1-555-0101", "avg_pause_ms": 395},
        {"timestamp": 3, "caller": "+1-555-0101", "avg_pause_ms": 405},
        {"timestamp": 4, "caller": "+1-555-0101", "avg_pause_ms": 390},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report.clinical_review_recommended is False
    assert report.degradation_slope <= 0
    assert report.status == ClinicalStatus.STABLE

def test_declining_patient():
    history = [
        {"timestamp": 1, "caller": "+1-555-0102", "avg_pause_ms": 400},
        {"timestamp": 2, "caller": "+1-555-0102", "avg_pause_ms": 500},
        {"timestamp": 3, "caller": "+1-555-0102", "avg_pause_ms": 550},
        {"timestamp": 4, "caller": "+1-555-0102", "avg_pause_ms": 650},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report.clinical_review_recommended is True
    assert report.degradation_slope > 50.0
    assert report.status == ClinicalStatus.DEGRADATION_DETECTED

def test_insufficient_data():
    history = [
        {"timestamp": 1, "caller": "+1-555-0103", "avg_pause_ms": 400},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report.clinical_review_recommended is False
    assert report.status == ClinicalStatus.INSUFFICIENT_DATA

def test_compliance_rejection():
    history = [
        {"timestamp": 1, "caller": "415-555-2671", "avg_pause_ms": 400},
        {"timestamp": 2, "caller": "415-555-2671", "avg_pause_ms": 500},
        {"timestamp": 3, "caller": "415-555-2671", "avg_pause_ms": 550}
    ]
    with pytest.raises(ValueError) as exc:
        analyze_longitudinal_biomarkers(history)
    assert "Compliance Error" in str(exc.value)
