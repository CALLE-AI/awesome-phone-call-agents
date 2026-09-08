import json

from known_number.task import RESULT_SCHEMA, build_task, idempotency_key


def test_task_carries_no_secret(request_v0417, vendor_v0417):
    task = build_task(request_v0417, vendor_v0417, company_name="Example Manufacturing Ltd")
    assert request_v0417.new_account_last4 not in task
    assert request_v0417.new_bank_name.lower() not in task.lower()
    assert vendor_v0417.current_account_last4 not in task
    assert request_v0417.callback_phone not in task
    assert vendor_v0417.known_phone not in task


def test_task_discloses_and_bounds(request_v0417, vendor_v0417):
    task = build_task(request_v0417, vendor_v0417, company_name="Example Manufacturing Ltd")
    assert "automated assistant" in task and "not a person" in task
    assert "Never accept new, different, or additional bank details" in task
    assert "last four digits" in task
    for name in vendor_v0417.authorized_contacts:
        assert name in task


def test_schema_is_json_serialisable_and_closed():
    text = json.dumps(RESULT_SCHEMA)
    assert '"enum"' in text
    for key in RESULT_SCHEMA["required"]:
        assert key in RESULT_SCHEMA["properties"]


def test_idempotency_key_is_per_ticket(request_v0417):
    assert idempotency_key(request_v0417) == "known-number:AP-2026-1183"
