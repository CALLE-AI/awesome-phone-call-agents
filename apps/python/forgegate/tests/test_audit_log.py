import audit_log


def test_append_and_read_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "LOG_DIR", tmp_path)
    monkeypatch.setattr(audit_log, "LOG_PATH", tmp_path / "audit_log.jsonl")

    audit_log.append_entry({"incident_id": "inc_001", "action_state": "AUTO-CLEARED"})
    audit_log.append_entry({"incident_id": "inc_002", "action_state": "HELD", "call_id": "call_1"})

    all_entries = audit_log.read_all()
    assert len(all_entries) == 2
    assert all_entries[0]["incident_id"] == "inc_001"
    assert "timestamp" in all_entries[0]


def test_read_for_incident_filters_by_id(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "LOG_DIR", tmp_path)
    monkeypatch.setattr(audit_log, "LOG_PATH", tmp_path / "audit_log.jsonl")

    audit_log.append_entry({"incident_id": "inc_001"})
    audit_log.append_entry({"incident_id": "inc_002"})
    audit_log.append_entry({"incident_id": "inc_001"})

    entries = audit_log.read_for_incident("inc_001")
    assert len(entries) == 2
    assert all(e["incident_id"] == "inc_001" for e in entries)


def test_has_existing_call_only_matches_entries_with_a_call_id(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "LOG_DIR", tmp_path)
    monkeypatch.setattr(audit_log, "LOG_PATH", tmp_path / "audit_log.jsonl")

    audit_log.append_entry({"incident_id": "inc_001", "call_id": None})
    assert audit_log.has_existing_call("inc_001") is None

    audit_log.append_entry({"incident_id": "inc_001", "call_id": "call_abc"})
    existing = audit_log.has_existing_call("inc_001")
    assert existing is not None
    assert existing["call_id"] == "call_abc"


def test_read_all_on_missing_file_returns_empty_list(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "LOG_DIR", tmp_path)
    monkeypatch.setattr(audit_log, "LOG_PATH", tmp_path / "does_not_exist.jsonl")
    assert audit_log.read_all() == []
