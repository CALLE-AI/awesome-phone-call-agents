import pytest
from bytelytic_clinic.adapters.calle_adapter import CalleAdapter
from bytelytic_clinic.config import ClinicConfig


def test_dry_run_confirmation_call():
    adapter = CalleAdapter()
    res = adapter.dispatch_confirmation_call(phone="+15550192834")
    assert res["status"] == "completed"
    assert res["task_completed"] is True
    assert res["structured_result"]["will_attend"] == "yes"
    assert res["recipient_masked"] == "+1555***2834"
    assert res["dry_run"] is True


def test_dry_run_noshow_recovery_call():
    adapter = CalleAdapter()
    res = adapter.dispatch_noshow_recovery_call(phone="+15550192834")
    assert res["status"] == "completed"
    assert res["task_completed"] is True
    assert res["structured_result"]["wants_rebook"] == "yes"
    assert res["structured_result"]["preferred_time"] == "Next Tuesday at 2:00 PM"


def test_dry_run_prior_auth_call():
    adapter = CalleAdapter()
    res = adapter.dispatch_prior_auth_call(
        payor_phone="1-800-676-2583",
        payor_name="Blue Cross Blue Shield",
        cpt_code="99213",
        member_id_masked="MBR-***-8492",
    )
    assert res["status"] == "completed"
    assert res["structured_result"]["auth_status"] == "approved"
    assert res["structured_result"]["authorization_number"] == "AUTH-882194"


def test_confirmation_custom_doctor_and_clinic():
    adapter = CalleAdapter()
    res = adapter.dispatch_confirmation_call(
        phone="+15550192834",
        doctor_name="Dr. Taylor Mitchell, MD",
        clinic_name="Downtown Physical Rehab",
    )
    assert res["status"] == "completed"
    assert res["evidence"][0].startswith("Patient confirmed")


def test_confirmation_idempotency_key_preserved():
    adapter = CalleAdapter()
    res = adapter.dispatch_confirmation_call(phone="+15550192834", idempotency_key="apt-unique-992")
    assert res["status"] == "completed"


def test_noshow_custom_time():
    adapter = CalleAdapter()
    res = adapter.dispatch_noshow_recovery_call(phone="+15550192834", missed_time="Yesterday at 3:00 PM")
    assert res["status"] == "completed"


def test_prior_auth_custom_ivr_hints():
    adapter = CalleAdapter()
    res = adapter.dispatch_prior_auth_call(
        payor_phone="1-800-555-1111",
        payor_name="Aetna Health",
        cpt_code="97110",
        member_id_masked="MBR-***-1122",
        ivr_hints="Press 3 for Physical Therapy pre-certification.",
    )
    assert res["status"] == "completed"


def test_calle_adapter_initializes_with_custom_config():
    cfg = ClinicConfig(clinic_name="City Sports Medicine", dry_run=True)
    adapter = CalleAdapter(cfg)
    assert adapter.cfg.clinic_name == "City Sports Medicine"


def test_calle_adapter_enforces_live_recipient_gate():
    cfg = ClinicConfig(dry_run=False, authorized_recipients=["+15550192834"])
    adapter = CalleAdapter(cfg)
    with pytest.raises(PermissionError):
        adapter.dispatch_confirmation_call(phone="+15559990000")


def test_calle_adapter_rejects_malformed_phone():
    adapter = CalleAdapter()
    with pytest.raises(ValueError):
        adapter.dispatch_confirmation_call(phone="invalid_phone")


def test_dry_run_recall_call():
    adapter = CalleAdapter()
    res = adapter.dispatch_recall_call(phone="+15550192834")
    assert res["status"] == "completed"
    assert res["task_completed"] is True
    assert res["structured_result"]["interested"] == "yes"
    assert res["structured_result"]["preferred_day"] == "Wednesday"
    assert res["dry_run"] is True


def test_dry_run_survey_call():
    adapter = CalleAdapter()
    res = adapter.dispatch_survey_call(phone="+15550192834")
    assert res["status"] == "completed"
    assert res["task_completed"] is True
    assert res["structured_result"]["nps_score"] == 9
    assert res["structured_result"]["would_recommend"] == "yes"
    assert res["dry_run"] is True


def test_recall_custom_interval():
    adapter = CalleAdapter()
    res = adapter.dispatch_recall_call(phone="+15550192834", recall_interval="90-day", care_type="annual wellness exam")
    assert res["status"] == "completed"
    assert "evidence" in res


def test_survey_custom_visit_date():
    adapter = CalleAdapter()
    res = adapter.dispatch_survey_call(phone="+15550192834", visit_date="Monday, August 25th")
    assert res["status"] == "completed"
    assert "structured_result" in res
