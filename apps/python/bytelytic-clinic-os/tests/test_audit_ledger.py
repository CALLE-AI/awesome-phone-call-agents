import pytest
from bytelytic_clinic.adapters.audit_ledger import AuditLedger


def test_audit_records_entry():
    ledger = AuditLedger()
    entry = ledger.record("nurse_agent", "call.dispatch", "appointment", "apt-101", {"notes": "confirmed"})
    assert len(ledger.entries) == 1
    assert entry.actor == "nurse_agent"
    assert entry.entry_hash is not None


def test_audit_ledger_integrity_passes():
    ledger = AuditLedger()
    ledger.record("agent_1", "call.dispatch", "appointment", "apt-1", {"status": "ok"})
    ledger.record("agent_2", "webhook.received", "appointment", "apt-2", {"status": "confirmed"})
    assert ledger.verify_integrity() is True


def test_audit_ledger_detects_tampering():
    ledger = AuditLedger()
    entry = ledger.record("agent_1", "call.dispatch", "appointment", "apt-1", {"status": "ok"})
    # Tamper with recorded details
    entry.details_sanitized["status"] = "tampered_value"
    assert ledger.verify_integrity() is False


def test_audit_ledger_sanitizes_phi_keys():
    ledger = AuditLedger()
    entry = ledger.record("receptionist", "patient.view", "patient", "p-1", {
        "patient_phone": "+15550192834",
        "patient_dob": "1990-01-01",
        "clinic_id": "c-101"
    })
    assert entry.details_sanitized["patient_phone"] == "***"
    assert entry.details_sanitized["patient_dob"] == "***"
    assert entry.details_sanitized["clinic_id"] == "c-101"


def test_audit_ledger_generates_unique_uuids():
    ledger = AuditLedger()
    e1 = ledger.record("actor", "act1", "res", "1", {})
    e2 = ledger.record("actor", "act2", "res", "2", {})
    assert e1.id != e2.id


def test_audit_ledger_empty_is_valid():
    ledger = AuditLedger()
    assert ledger.verify_integrity() is True
