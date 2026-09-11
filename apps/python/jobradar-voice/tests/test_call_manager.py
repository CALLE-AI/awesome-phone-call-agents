from call_manager import (
    create_call_record,
    mark_call_started,
    mark_call_completed,
    mark_outcome_unknown,
    should_retry_call
)


def sample_business():
    return {
        "name": "Metro Warehouse",
        "phone": "+911234567890",
        "location": "Vadodara"
    }


def test_call_record_created():
    record = create_call_record(sample_business())

    assert record["status"] == "prepared"
    assert record["attempt"] == 0


def test_completed_call_cannot_retry():
    record = create_call_record(sample_business())
    record = mark_call_started(record)
    record = mark_call_completed(record)

    allowed, _ = should_retry_call(record)

    assert allowed is False


def test_unknown_outcome_cannot_auto_retry():
    record = create_call_record(sample_business())
    record = mark_call_started(record)
    record = mark_outcome_unknown(record)

    allowed, _ = should_retry_call(record)

    assert allowed is False