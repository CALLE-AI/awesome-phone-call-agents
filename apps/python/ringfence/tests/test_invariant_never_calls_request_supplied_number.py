"""The load-bearing test: RingFence never dials a number that arrived as
part of the flagged request, even when that number is identical to, or
disguised to look like, the on-file number.
"""

from ringfence.case import Case
from ringfence.verify_call import (
    DEFAULT_INSTITUTION_NAME,
    PREVIEWED,
    SecurityEventLog,
    place_verification_call,
    render_task,
    resolve_dial_target,
)

_ON_FILE = "+14155550101"
_SMUGGLED = "+14155559999"


def _make_case(**overrides) -> Case:
    fields = dict(
        case_id="case_001",
        account_holder_name="Pat Rivera",
        on_file_phone=_ON_FILE,
        claimed_transaction_amount="4500.00",
        claimed_recipient="Jordan Rivera",
        claimed_payment_method="wire",
        request_supplied_callback_number=None,
    )
    fields.update(overrides)
    return Case(**fields)


def test_dial_target_is_always_the_on_file_number():
    case = _make_case(request_supplied_callback_number=_SMUGGLED)
    assert resolve_dial_target(case) == _ON_FILE


def test_dial_target_ignores_request_supplied_number_even_when_absent():
    case = _make_case(request_supplied_callback_number=None)
    assert resolve_dial_target(case) == _ON_FILE


def test_smuggled_number_identical_to_on_file_is_still_just_on_file():
    # Not a special case: resolve_dial_target never reads the smuggled field
    # for dialing purposes, so an attacker who guesses the real number gains
    # nothing.
    case = _make_case(request_supplied_callback_number=_ON_FILE)
    assert resolve_dial_target(case) == _ON_FILE


def test_smuggled_number_is_logged_as_a_security_event(tmp_path):
    case = _make_case(request_supplied_callback_number=_SMUGGLED)
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    target = resolve_dial_target(case, security_log=log)
    assert target == _ON_FILE
    assert len(log.events) == 1
    event = log.events[0]
    assert event["event"] == "rejected_request_supplied_callback_number"
    assert event["case_id"] == "case_001"
    # Neither phone number appears unmasked in the logged event.
    assert _ON_FILE not in json_dump(event)
    assert _SMUGGLED not in json_dump(event)


def test_no_smuggled_number_logs_nothing(tmp_path):
    case = _make_case(request_supplied_callback_number=None)
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    resolve_dial_target(case, security_log=log)
    assert log.events == []


def test_place_verification_call_dry_run_dials_on_file_number_only(tmp_path):
    case = _make_case(request_supplied_callback_number=_SMUGGLED)
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    outcome = place_verification_call(case, live=False, security_log=log)
    assert outcome.status == PREVIEWED
    assert len(log.events) == 1


def test_place_verification_call_live_dials_on_file_number_via_client(tmp_path):
    dialed = {}

    class _FakeCalls:
        def create_and_wait(self, **kwargs):
            dialed["recipients"] = kwargs["recipients"]
            return {"id": "call_fake_1"}

    class _FakeClient:
        calls = _FakeCalls()

    case = _make_case(request_supplied_callback_number=_SMUGGLED)
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    outcome = place_verification_call(
        case, live=True, security_log=log, client_factory=lambda: _FakeClient()
    )
    assert outcome.call_id == "call_fake_1"
    assert dialed["recipients"] == [{"phones": [_ON_FILE], "region": "US", "locale": "en-US"}]
    assert _SMUGGLED not in str(dialed)


def test_place_verification_call_uses_the_case_s_own_region_and_locale_when_set(tmp_path):
    # Found missing entirely by a real live-call test to a documented-
    # supported international number (+91/IN) -- omitting region/locale
    # caused calls to a supported international number to fail instantly.
    dialed = {}

    class _FakeCalls:
        def create_and_wait(self, **kwargs):
            dialed["recipients"] = kwargs["recipients"]
            return {"id": "call_fake_2"}

    class _FakeClient:
        calls = _FakeCalls()

    case = _make_case(on_file_phone="+919876543210", region="IN", locale="en-US")
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    place_verification_call(case, live=True, security_log=log, client_factory=lambda: _FakeClient())
    assert dialed["recipients"] == [{"phones": ["+919876543210"], "region": "IN", "locale": "en-US"}]


def test_place_verification_call_falls_back_to_default_region_and_locale_when_unset(tmp_path):
    dialed = {}

    class _FakeCalls:
        def create_and_wait(self, **kwargs):
            dialed["recipients"] = kwargs["recipients"]
            return {"id": "call_fake_3"}

    class _FakeClient:
        calls = _FakeCalls()

    case = _make_case()  # region/locale left unset
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    place_verification_call(case, live=True, security_log=log, client_factory=lambda: _FakeClient())
    assert dialed["recipients"][0]["region"] == "US"
    assert dialed["recipients"][0]["locale"] == "en-US"


def test_render_task_names_a_concrete_institution_not_a_vague_one():
    # Found by exercising the live API, not by review: CALL-E's
    # own content-policy layer rejects a task that never names a concrete
    # requesting entity, citing exactly the vague/hidden-identity risk this
    # project's own detection logic screens callers for.
    case = _make_case()
    task = render_task(case)
    assert DEFAULT_INSTITUTION_NAME in task
    assert "their financial institution" not in task


def test_render_task_uses_the_case_s_own_institution_name_when_set():
    case = _make_case(institution_name="Contoso Federal Credit Union")
    task = render_task(case)
    assert "Contoso Federal Credit Union" in task
    assert DEFAULT_INSTITUTION_NAME not in task


def json_dump(obj) -> str:
    import json

    return json.dumps(obj)
