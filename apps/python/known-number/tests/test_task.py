import json

from known_number.task import RESULT_SCHEMA, build_task, idempotency_key


def test_task_carries_no_payment_information(request_v0417, vendor_v0417):
    task = build_task(request_v0417, vendor_v0417, company_name="Example Manufacturing Ltd", reference="HE4NF5")
    assert request_v0417.new_account_last4 not in task
    assert request_v0417.new_bank_name.lower() not in task.lower()
    assert vendor_v0417.current_bank_name.lower() not in task.lower()
    assert vendor_v0417.current_account_last4 not in task
    assert "last four" not in task.lower()
    assert request_v0417.callback_phone not in task
    assert vendor_v0417.known_phone not in task


def test_task_discloses_and_bounds(request_v0417, vendor_v0417):
    task = build_task(request_v0417, vendor_v0417, company_name="Example Manufacturing Ltd", reference="HE4NF5")
    assert "automated assistant" in task and "not a person" in task
    assert "Do not ask for, accept, repeat, or discuss any banking, account, payment, password, or code information" in task
    assert "H E 4 N F 5" in task
    assert "do not ask them to read anything out" in task
    for name in vendor_v0417.authorized_contacts:
        assert name in task


def test_schema_is_json_serialisable_and_closed():
    text = json.dumps(RESULT_SCHEMA)
    assert '"enum"' in text
    for key in RESULT_SCHEMA["required"]:
        assert key in RESULT_SCHEMA["properties"]


def test_idempotency_key_is_per_ticket(request_v0417):
    assert idempotency_key(request_v0417) == "known-number:AP-2026-1183:0"
    a = idempotency_key(request_v0417, "task A")
    assert a == idempotency_key(request_v0417, "task A") and a != idempotency_key(request_v0417, "task B")
