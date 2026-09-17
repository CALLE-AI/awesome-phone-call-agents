import pytest
from cognitive_tracker import analyze_longitudinal_biomarkers

def test_stable_patient():
    history = [
        {"timestamp": 1, "caller": "+1-555-0101", "avg_pause_ms": 400},
        {"timestamp": 2, "caller": "+1-555-0101", "avg_pause_ms": 395},
        {"timestamp": 3, "caller": "+1-555-0101", "avg_pause_ms": 405},
        {"timestamp": 4, "caller": "+1-555-0101", "avg_pause_ms": 390},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report["CLINICAL_REVIEW_RECOMMENDED"] is False
    assert report["degradation_slope"] <= 0
    assert report["status"] == "Stable cognitive markers."

def test_declining_patient():
    history = [
        {"timestamp": 1, "caller": "+1-555-0102", "avg_pause_ms": 400},
        {"timestamp": 2, "caller": "+1-555-0102", "avg_pause_ms": 500},
        {"timestamp": 3, "caller": "+1-555-0102", "avg_pause_ms": 550},
        {"timestamp": 4, "caller": "+1-555-0102", "avg_pause_ms": 650},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report["CLINICAL_REVIEW_RECOMMENDED"] is True
    assert report["degradation_slope"] > 50.0
    assert report["status"] == "Significant cognitive degradation detected."

def test_insufficient_data():
    history = [
        {"timestamp": 1, "caller": "+1-555-0103", "avg_pause_ms": 400},
    ]
    report = analyze_longitudinal_biomarkers(history)
    assert report["CLINICAL_REVIEW_RECOMMENDED"] is False
    assert report["status"] == "Insufficient data"
