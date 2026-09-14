"""Unit and light integration tests for client.py's reused primitives:
the REST transport (CallEClient), task-hardening (build_hardened_task),
and disclosure-script rendering (render_disclosure_script) - all against
fake_server.py only, never api.heycall-e.com.

client.py has no CLI of its own; resolver.py is Reality Resolver's only
entry point (see tests/test_resolver_e2e.py for its own end-to-end
coverage). This file only proves the primitives resolver.py builds on.
"""

from __future__ import annotations

from typing import Any

import pytest

import client as client_module
from client import (
    CALL_CLOSING_INSTRUCTIONS,
    DISCLOSURE_INSTRUCTION_HEADER,
    MAX_DISPLAY_CHARS,
    MAX_IDENTIFIER_DISPLAY_CHARS,
    MAX_TASK_DISPLAY_CHARS,
    NO_REPEAT_OPENING_INSTRUCTIONS,
    PHONE_PATTERN,
    PROACTIVE_NEXT_STEP_INSTRUCTIONS,
    REAL_API_BASE_URL,
    TASK_INJECTION_RESISTANCE_INSTRUCTIONS,
    VOICEMAIL_HANDLING_INSTRUCTIONS,
    CallEAPIError,
    CallEClient,
    LiveCallBlockedError,
    build_hardened_task,
    build_recipient,
    redacted_call_for_display,
    render_disclosure_script,
    sanitize_for_display,
)
from compliance.jurisdictions import fr, us_federal
from fake_server import INSUFFICIENT_BALANCE_PHONE, RATE_LIMITED_ONCE_PHONE, FakeCalleServer
from verdict import subject_intent_result_schema

TEST_API_KEY = "iams_live_fake_test_key_do_not_use"

FR_PHONE = "+33639980456"  # ARCEP Numbering Plan Art. 2.5.12 reserved mobile block "06 39 98"

# Control characters used by the display-sanitization tests below, built
# from code points so this file stays pure ASCII.
ESC = chr(27)
BEL = chr(7)
CR = chr(13)
LF = chr(10)


def test_live_base_url_is_blocked_without_allow_live() -> None:
    with pytest.raises(LiveCallBlockedError):
        CallEClient(base_url=REAL_API_BASE_URL, api_key=TEST_API_KEY, allow_live=False)


def test_create_and_poll_reaches_completed_with_structured_result() -> None:
    """Proves the REST transport itself (CallEClient) works end to end
    against the fake server, using the same subject_intent_result_schema
    Reality Resolver actually sends.
    """
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key=TEST_API_KEY)
        recipient = build_recipient(FR_PHONE, locale="fr-FR", region="FR")

        created = client.create_call(
            task="Call the recipient to confirm their appointment.",
            recipients=[recipient],
            result_schema=subject_intent_result_schema(),
            idempotency_key="test-happy-path-1",
        )
        assert created["status"] == "queued"
        assert created["id"].startswith("call_")

        final_call = client.poll_until_terminal(created["id"], interval_seconds=0.01, timeout_seconds=5)

        assert final_call["status"] == "completed"
        assert final_call["structured_result"] == {
            "subject_intent": "confirmed",
            "answered_by": "human",
            "confidence_note": "Fake server: deterministic canned result, not extracted from real call evidence.",
            "manipulation_attempt_detected": False,
        }
        assert final_call["recipients"][0]["locale"] == "fr-FR"
        assert final_call["recipients"][0]["region"] == "FR"
        assert server.creates == 1


class _FakeClock:
    """Lets poll_until_terminal tests simulate minutes of elapsed time
    instantly instead of actually sleeping - fake_server.py's CallRecord
    status is driven by read count, not wall-clock time, so it can't
    simulate a long-running call on its own; these tests monkeypatch
    client.time.monotonic/client.time.sleep and stub get_call directly.
    """

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _stub_get_call(statuses: list[str]) -> Any:
    calls = {"count": 0}

    def get_call(self, call_id: str) -> dict[str, Any]:
        index = min(calls["count"], len(statuses) - 1)
        calls["count"] += 1
        return {"id": call_id, "status": statuses[index]}

    return get_call


def test_poll_until_terminal_polls_indefinitely_by_default(monkeypatch) -> None:
    clock = _FakeClock()
    monkeypatch.setattr(client_module.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(client_module.time, "sleep", clock.sleep)
    monkeypatch.setattr(
        CallEClient, "get_call", _stub_get_call(["in_progress"] * 20 + ["completed"])
    )

    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    final_call = api_client.poll_until_terminal("call_123", interval_seconds=60.0)

    assert final_call["status"] == "completed"


def test_poll_until_terminal_warns_repeatedly_at_expected_intervals(monkeypatch) -> None:
    clock = _FakeClock()
    monkeypatch.setattr(client_module.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(client_module.time, "sleep", clock.sleep)
    # 16 non-terminal reads then completed: crosses the 300s/600s/900s warn
    # thresholds (at reads 6, 11, 16) and reaches "completed" on read 17,
    # just before a 4th warning (1200s) would otherwise fire.
    monkeypatch.setattr(
        CallEClient, "get_call", _stub_get_call(["in_progress"] * 16 + ["completed"])
    )

    warnings: list[float] = []
    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    api_client.poll_until_terminal(
        "call_123",
        interval_seconds=60.0,
        warn_after_seconds=300.0,
        on_warn=lambda minutes, call: warnings.append(minutes),
    )

    assert warnings == [5.0, 10.0, 15.0]


def test_poll_until_terminal_no_warnings_when_disabled(monkeypatch) -> None:
    clock = _FakeClock()
    monkeypatch.setattr(client_module.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(client_module.time, "sleep", clock.sleep)
    monkeypatch.setattr(
        CallEClient, "get_call", _stub_get_call(["in_progress"] * 30 + ["completed"])
    )

    warnings: list[float] = []
    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    api_client.poll_until_terminal(
        "call_123",
        interval_seconds=60.0,
        warn_after_seconds=None,
        on_warn=lambda minutes, call: warnings.append(minutes),
    )

    assert warnings == []


def test_poll_until_terminal_explicit_timeout_still_raises(monkeypatch) -> None:
    clock = _FakeClock()
    monkeypatch.setattr(client_module.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(client_module.time, "sleep", clock.sleep)
    monkeypatch.setattr(CallEClient, "get_call", _stub_get_call(["in_progress"]))

    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    with pytest.raises(TimeoutError):
        api_client.poll_until_terminal("call_123", interval_seconds=10.0, timeout_seconds=30.0)


def test_insufficient_balance_error_is_surfaced() -> None:
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key=TEST_API_KEY)
        recipient = build_recipient(INSUFFICIENT_BALANCE_PHONE, locale="fr-FR", region="FR")

        with pytest.raises(CallEAPIError) as exc_info:
            client.create_call(task="Call the recipient.", recipients=[recipient])

        assert exc_info.value.code == "insufficient_balance"
        assert exc_info.value.status_code == 402


def test_unsupported_region_error_is_surfaced() -> None:
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key=TEST_API_KEY)
        recipient = build_recipient(FR_PHONE, locale="fr-FR", region="ZZ")

        with pytest.raises(CallEAPIError) as exc_info:
            client.create_call(task="Call the recipient.", recipients=[recipient])

        assert exc_info.value.code == "unsupported_region"


def test_unsupported_language_error_is_surfaced() -> None:
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key=TEST_API_KEY)
        recipient = build_recipient(FR_PHONE, locale="zz-ZZ", region="FR")

        with pytest.raises(CallEAPIError) as exc_info:
            client.create_call(task="Call the recipient.", recipients=[recipient])

        assert exc_info.value.code == "unsupported_language"


def test_invalid_phone_is_rejected_locally_before_any_request() -> None:
    with FakeCalleServer() as server:
        with pytest.raises(ValueError):
            build_recipient("not-a-phone", locale="fr-FR", region="FR")
        assert server.requests == 0


# Unicode decimal digits from four different scripts. Each of these is a
# "digit" to Python's \d but is not an ASCII digit, so an E.164 check
# written with \d would accept them and the number would reach the
# provider verbatim - see PHONE_PATTERN's comment in client.py.
NON_ASCII_DIGIT_PHONES = {
    "arabic_indic": "+1" + "\u0662\u0663\u0664\u0665\u0666\u0667",
    "devanagari": "+1" + "\u0968\u0969\u096a\u096b\u096c\u096d",
    "fullwidth": "+1" + "\uff12\uff13\uff14\uff15\uff16\uff17",
    "burmese": "+1" + "\u1042\u1043\u1044\u1045\u1046\u1047",
}


@pytest.mark.parametrize("script", sorted(NON_ASCII_DIGIT_PHONES))
def test_non_ascii_digits_are_rejected(script) -> None:
    phone = NON_ASCII_DIGIT_PHONES[script]
    assert not phone.isascii()
    assert PHONE_PATTERN.match(phone) is None
    with pytest.raises(ValueError):
        build_recipient(phone, locale="en-US", region="US")


@pytest.mark.parametrize(
    "phone",
    [
        "+12025550123",  # NANP reserved NPA-555-01XX
        "+15035550100",  # NANP reserved, Oregon area code
        "+33639980456",  # ARCEP reserved mobile fiction block 06 39 98
        "+10000000001",  # fake_server sentinel, area code 000
        # E.164 length boundaries. No regulator-reserved block exists at
        # these lengths, so these two are the only test numbers not from
        # one - both are structurally impossible to route (a NANP number
        # needs exactly 10 digits after +1), see the README's Safety
        # section.
        "+1234567",  # shortest form the pattern allows (1 + 6 digits)
        "+123456789012345",  # longest form the pattern allows (1 + 14 digits)
    ],
)
def test_ascii_e164_numbers_still_accepted(phone) -> None:
    """The ASCII tightening must not reject anything that was legitimately
    accepted before - including both length boundaries of the pattern.
    """
    assert PHONE_PATTERN.match(phone) is not None
    assert build_recipient(phone, locale="en-US", region="US")["phones"] == [phone]


@pytest.mark.parametrize(
    "phone",
    [
        "+1202555\u00a00123",  # non-breaking space
        "+1202555\u200d0123",  # zero-width joiner
        "+1202555\u200f0123",  # right-to-left mark
        "+1 2025550123",  # ASCII space
        "+1-202-555-0123",  # separators
        "+0202555012345",  # leading zero after +
        "12025550123",  # no leading +
        "",
    ],
)
def test_other_malformed_phones_stay_rejected(phone) -> None:
    assert PHONE_PATTERN.match(phone) is None


def test_unauthorized_when_api_key_is_empty() -> None:
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key="")
        recipient = build_recipient(FR_PHONE, locale="fr-FR", region="FR")

        with pytest.raises(CallEAPIError) as exc_info:
            client.create_call(task="Call the recipient.", recipients=[recipient])

        assert exc_info.value.code == "unauthorized"
        assert exc_info.value.status_code == 401


def test_create_call_raises_immediately_on_rate_limit_without_retrying() -> None:
    """POST /v1/calls is never retried automatically, not even for a
    transient-looking status like 429 - see the module docstring and
    CallEClient._raise_ambiguous_post_failure. GET/poll_until_terminal
    keeps its own retry-with-backoff, unaffected by this.
    """
    with FakeCalleServer() as server:
        client = CallEClient(base_url=server.base_url, api_key=TEST_API_KEY)
        recipient = build_recipient(RATE_LIMITED_ONCE_PHONE, locale="fr-FR", region="FR")

        with pytest.raises(CallEAPIError) as exc_info:
            client.create_call(
                task="Call the recipient.",
                recipients=[recipient],
                idempotency_key="test-rate-limit-1",
            )
        assert exc_info.value.code == "rate_limit_exceeded"


def test_create_call_never_retries_ambiguous_failure_with_idempotency_key(monkeypatch) -> None:
    """A POST that gets no confirmed HTTP response (timeout, connection
    error) must never be retried automatically - even though CALL-E
    guarantees replaying the same Idempotency-Key and body would be safe,
    a call-creation request that might already have been accepted by the
    provider is never silently repeated. The failure surfaces immediately
    instead.
    """
    call_count = {"n": 0}

    def fake_urlopen(request: object, timeout: float | None = None) -> None:
        call_count["n"] += 1
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fake_urlopen)

    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    with pytest.raises(RuntimeError) as exc_info:
        api_client.create_call(task="Call the recipient.", idempotency_key="idem-no-retry-test")

    assert call_count["n"] == 1
    message = str(exc_info.value)
    assert "no automatic retry" in message
    assert "Idempotency-Key was idem-no-retry-test" in message


def test_create_call_never_retries_ambiguous_failure_without_idempotency_key(monkeypatch) -> None:
    call_count = {"n": 0}

    def fake_urlopen(request: object, timeout: float | None = None) -> None:
        call_count["n"] += 1
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fake_urlopen)

    api_client = CallEClient(base_url="http://fake", api_key=TEST_API_KEY)
    with pytest.raises(RuntimeError) as exc_info:
        api_client.create_call(task="Call the recipient.")

    assert call_count["n"] == 1
    assert "Idempotency-Key was <none>" in str(exc_info.value)


def test_build_hardened_task_is_operator_task_plus_fixed_blocks_in_order() -> None:
    operator_task = "Call the recipient to confirm their appointment."
    expected = (
        f"{operator_task}\n\n{TASK_INJECTION_RESISTANCE_INSTRUCTIONS}"
        f"\n\n{VOICEMAIL_HANDLING_INSTRUCTIONS}"
        f"\n\n{NO_REPEAT_OPENING_INSTRUCTIONS}"
        f"\n\n{PROACTIVE_NEXT_STEP_INSTRUCTIONS}"
        f"\n\n{CALL_CLOSING_INSTRUCTIONS}"
    )
    assert build_hardened_task(operator_task) == expected


def test_build_hardened_task_disclosure_script_comes_first() -> None:
    """AI disclosure must happen at the very start of the call - the
    disclosure block comes before the operator's own task, before
    everything else.
    """
    operator_task = "Call the recipient to confirm their appointment."
    disclosure_script = "This call is made by an artificial intelligence system."
    result = build_hardened_task(operator_task, disclosure_script)

    disclosure_index = result.index(DISCLOSURE_INSTRUCTION_HEADER)
    task_index = result.index(operator_task)
    resistance_index = result.index(TASK_INJECTION_RESISTANCE_INSTRUCTIONS)
    voicemail_index = result.index(VOICEMAIL_HANDLING_INSTRUCTIONS)
    no_repeat_index = result.index(NO_REPEAT_OPENING_INSTRUCTIONS)
    proactive_index = result.index(PROACTIVE_NEXT_STEP_INSTRUCTIONS)
    closing_index = result.index(CALL_CLOSING_INSTRUCTIONS)
    assert (
        disclosure_index
        < task_index
        < resistance_index
        < voicemail_index
        < no_repeat_index
        < proactive_index
        < closing_index
    )
    assert disclosure_script in result


def test_build_hardened_task_call_closing_comes_last() -> None:
    operator_task = "Call the recipient to confirm their appointment."
    result = build_hardened_task(operator_task)

    assert CALL_CLOSING_INSTRUCTIONS in result
    voicemail_index = result.index(VOICEMAIL_HANDLING_INSTRUCTIONS)
    closing_index = result.index(CALL_CLOSING_INSTRUCTIONS)
    assert voicemail_index < closing_index


def test_render_disclosure_script_fills_all_placeholder_kinds() -> None:
    result = render_disclosure_script(us_federal.DISCLOSURE_SCRIPT, "Bright Smile Dental", "Alex")
    assert "[AGENT_NAME]" not in result
    assert "[ENTITY]" not in result
    assert "[REASON_FOR_CALLING]" not in result
    assert "[CALLBACK_NUMBER]" not in result
    assert "Bright Smile Dental" in result
    assert "Alex" in result


def test_render_disclosure_script_generic_fallback_without_entity_name() -> None:
    result = render_disclosure_script(us_federal.DISCLOSURE_SCRIPT, None, None)
    assert "[ENTITY]" not in result
    assert "this organization" in result


def test_render_disclosure_script_french_fallback() -> None:
    result = render_disclosure_script(fr.DISCLOSURE_SCRIPT, None, None)
    assert "[ENTITE]" not in result
    assert "cette organisation" in result


def test_render_disclosure_script_agent_name_fallback_is_neutral() -> None:
    result = render_disclosure_script(us_federal.DISCLOSURE_SCRIPT, None, None)
    assert "[AGENT_NAME]" not in result
    assert "an automated calling agent" in result


def test_render_disclosure_script_reason_instruction_forbids_asking_recipient() -> None:
    result = render_disclosure_script(us_federal.DISCLOSURE_SCRIPT, None, None)
    assert "[REASON_FOR_CALLING]" not in result
    assert "do not ask the recipient" in result


def test_render_disclosure_script_reason_comes_before_closing_statement() -> None:
    en_result = render_disclosure_script(us_federal.DISCLOSURE_SCRIPT, None, None)
    reason_index = en_result.index("state briefly and naturally why you are calling")
    closing_index = en_result.index("This call uses an artificial voice")
    assert reason_index < closing_index

    fr_result = render_disclosure_script(fr.DISCLOSURE_SCRIPT, None, None)
    reason_index_fr = fr_result.index("expliquez brievement")
    closing_index_fr = fr_result.index("Vous pouvez demander")
    assert reason_index_fr < closing_index_fr


# --- P2: display sanitization of provider-controlled free text ----------
#
# reconcile() and the rest of the engine keep the provider's raw values;
# only what reaches a terminal or a redirected log goes through
# sanitize_for_display. These are the adversarial cases.

ANSI_CLEAR_AND_COLOUR = "OK" + ESC + "[2J" + ESC + "[31mINJECTED" + BEL


def test_sanitize_neutralizes_ansi_escape_sequences() -> None:
    out = sanitize_for_display(ANSI_CLEAR_AND_COLOUR)
    assert ESC not in out
    assert BEL not in out
    assert "INJECTED" in out          # content stays readable
    assert "u001b" in out or "x1b" in out


def test_sanitize_neutralizes_carriage_return_and_newlines() -> None:
    out = sanitize_for_display("first line" + CR + "overwritten" + LF + "second")
    assert CR not in out
    assert LF not in out
    assert "overwritten" in out


def test_sanitize_neutralizes_arbitrary_control_characters() -> None:
    controls = "".join(chr(c) for c in range(0, 32)) + chr(127)
    out = sanitize_for_display(controls)
    assert all(c not in out for c in controls)
    assert out.isascii()


def test_sanitize_bounds_very_long_strings() -> None:
    out = sanitize_for_display("A" * 100000)
    assert len(out) < 100000
    assert "truncated" in out
    assert "100000 chars total" in out


def test_sanitize_leaves_ordinary_text_untouched() -> None:
    ordinary = "The recipient confirmed the appointment for 14:00 (slot #3)."
    assert sanitize_for_display(ordinary) == ordinary


def test_sanitize_escapes_non_ascii_without_dropping_information() -> None:
    out = sanitize_for_display("caf" + chr(0xe9))
    assert out.isascii()
    assert "caf" in out


def test_sanitize_handles_non_string_values() -> None:
    assert sanitize_for_display(None) == "None"
    assert "42" in sanitize_for_display({"code": 42})


def test_api_error_str_is_sanitized_but_keeps_raw_attributes() -> None:
    """A hostile provider message must not reach the terminal raw, while
    the attributes stay untouched for callers that need the real value.
    """
    hostile = "boom" + ESC + "[2Jwiped"
    err = CallEAPIError(400, "invalid_request", hostile, {"field" + ESC: "bad" + BEL})
    rendered = str(err)
    assert ESC not in rendered
    assert BEL not in rendered
    assert err.message == hostile          # raw value preserved
    assert err.details == {"field" + ESC: "bad" + BEL}


def test_hostile_free_text_in_call_result_never_reaches_terminal_raw() -> None:
    """End to end over the fields a provider actually controls: summary,
    failure_message, confidence_note, manipulation_attempt_note and a
    transcript turn. json.dumps already escapes control characters in the
    dumped body; this pins that guarantee so a future switch away from
    json.dumps cannot silently reintroduce raw ESC output.
    """
    import json

    hostile_call = {
        "id": "call_x" + ESC + "[2J",
        "status": "failed" + BEL,
        "summary": "all good" + ESC + "[31m",
        "failure_message": "nope" + CR + "cleared",
        "structured_result": {
            "confidence_note": "note" + ESC + "[2K",
            "manipulation_attempt_note": "note" + chr(0),
        },
        "recipients": [
            {
                "phones": ["+12025550123"],
                "attempts": [
                    {"phone": "+12025550123", "transcript_turns": [{"text": "hi" + ESC + "[5m"}]}
                ],
            }
        ],
    }
    dumped = json.dumps(redacted_call_for_display(hostile_call), indent=2)
    assert ESC not in dumped
    assert BEL not in dumped
    assert CR not in dumped
    assert chr(0) not in dumped
    for field in ("id", "status", "summary", "failure_message"):
        assert ESC not in sanitize_for_display(hostile_call[field])


# --- P2-bis: central display sanitization of the whole provider object ---


def _hostile_call() -> dict:
    """A CallTask-shaped response where every free-text field carries both
    a terminal escape and 100k characters of payload.
    """
    poison = ESC + "[2J" + ESC + "[31m" + CR + chr(0) + chr(127) + chr(0x9B)
    long_text = "A" * 100000
    return {
        "id": "call_" + poison + long_text,
        "object": "call_task",
        "status": "failed" + poison,
        "task": "task" + poison + long_text,
        "summary": "summary" + poison + long_text,
        "failure_code": "code" + poison,
        "failure_message": "why" + poison + long_text,
        "evidence": ["ev1" + poison + long_text, "ev2" + poison + long_text],
        "task_completed": True,
        "completion_confidence": {"score": 0.86, "label": "high" + poison},
        "structured_result": {
            "subject_intent": "unknown",
            "confidence_note": "note" + poison + long_text,
            "manipulation_attempt_note": "note2" + poison + long_text,
            "manipulation_attempt_detected": False,
        },
        "recipients": [
            {
                "id": "rcp_1",
                "phones": ["+12025550123"],
                "summary": "rsum" + poison + long_text,
                "attempts": [
                    {
                        "phone": "+12025550123",
                        "summary": "asum" + poison + long_text,
                        "failure_message": "afail" + poison + long_text,
                        "provider_call_id": "prov" + poison,
                        "transcript_turns": [
                            {"offset_seconds": 0, "speaker": "user", "text": "said" + poison + long_text}
                        ],
                    }
                ],
            }
        ],
    }


def _all_strings(value, out=None):
    out = [] if out is None else out
    if isinstance(value, dict):
        for inner in value.values():
            _all_strings(inner, out)
    elif isinstance(value, list):
        for item in value:
            _all_strings(item, out)
    elif isinstance(value, str):
        out.append(value)
    return out


def test_no_control_character_survives_the_display_copy() -> None:
    """Requirements 1, 2 and 6 at once, over every string in the object:
    no ESC, CR, NUL, DEL or C1 introducer survives anywhere.
    """
    display = redacted_call_for_display(_hostile_call())
    forbidden = {ESC, CR, LF, BEL, chr(0), chr(127), chr(0x9B)}
    for text in _all_strings(display):
        assert not (forbidden & set(text)), repr(text[:60])


def test_every_field_is_bounded_independently() -> None:
    """Requirement 5: each long field is truncated on its own, and none is
    bounded by another field's budget.
    """
    display = redacted_call_for_display(_hostile_call())
    assert len(display["summary"]) <= MAX_DISPLAY_CHARS
    assert len(display["failure_message"]) <= MAX_DISPLAY_CHARS
    assert len(display["evidence"][0]) <= MAX_DISPLAY_CHARS
    assert len(display["evidence"][1]) <= MAX_DISPLAY_CHARS
    assert len(display["structured_result"]["confidence_note"]) <= MAX_DISPLAY_CHARS
    assert len(display["structured_result"]["manipulation_attempt_note"]) <= MAX_DISPLAY_CHARS
    assert len(display["recipients"][0]["summary"]) <= MAX_DISPLAY_CHARS
    assert len(display["recipients"][0]["attempts"][0]["summary"]) <= MAX_DISPLAY_CHARS
    assert len(display["recipients"][0]["attempts"][0]["transcript_turns"][0]["text"]) <= MAX_DISPLAY_CHARS
    # Each carries its own truncation marker - nothing is silently cut.
    assert "truncated" in display["evidence"][0]
    assert "truncated" in display["evidence"][1]


def test_identifier_fields_use_the_shorter_limit() -> None:
    display = redacted_call_for_display(_hostile_call())
    assert len(display["id"]) <= MAX_IDENTIFIER_DISPLAY_CHARS
    assert len(display["status"]) <= MAX_IDENTIFIER_DISPLAY_CHARS
    assert len(display["failure_code"]) <= MAX_IDENTIFIER_DISPLAY_CHARS
    assert len(display["recipients"][0]["attempts"][0]["provider_call_id"]) <= MAX_IDENTIFIER_DISPLAY_CHARS
    assert len(display["completion_confidence"]["label"]) <= MAX_IDENTIFIER_DISPLAY_CHARS


def test_task_echo_is_bounded_but_roomier_than_ordinary_free_text() -> None:
    display = redacted_call_for_display(_hostile_call())
    assert len(display["task"]) <= MAX_TASK_DISPLAY_CHARS
    assert MAX_TASK_DISPLAY_CHARS > MAX_DISPLAY_CHARS  # a real hardened task still fits


def test_display_copy_stays_valid_json_and_keeps_structure() -> None:
    """Requirement 4: bounding per field, never truncating the serialized
    document, so the result round-trips through JSON unchanged.
    """
    import json

    display = redacted_call_for_display(_hostile_call())
    dumped = json.dumps(display, indent=2)
    assert json.loads(dumped) == display
    assert ESC not in dumped and CR not in dumped and chr(0) not in dumped
    # Structure and non-string types survive intact.
    assert display["completion_confidence"]["score"] == 0.86
    assert display["task_completed"] is True
    assert display["structured_result"]["manipulation_attempt_detected"] is False
    assert display["structured_result"]["subject_intent"] == "unknown"
    assert len(display["evidence"]) == 2
    assert display["recipients"][0]["attempts"][0]["transcript_turns"][0]["offset_seconds"] == 0


def test_display_copy_never_mutates_the_original_response() -> None:
    """Precondition for requirement 9: the caller keeps the untouched
    object for verdict.reconcile(), so sanitizing for display must never
    reach back into the response the engine reasons about.
    """
    import copy

    original = _hostile_call()
    before = copy.deepcopy(original)
    redacted_call_for_display(original)
    assert original == before


def test_reconcile_sees_the_raw_result_not_the_display_copy() -> None:
    """Requirement 9: a structured_result carrying control characters and
    padding still reconciles on its real values - sanitization must never
    sit between the provider and the decision.
    """
    from datetime import timedelta

    from evidence.model import Ambiguity, Evidence, EvidenceMatrix, EvidenceType
    from verdict import reconcile

    matrix = EvidenceMatrix(
        (Evidence("calendar", EvidenceType.STRUCTURED, timedelta(hours=1), "confirmed", Ambiguity.LOW),)
    )
    raw = {
        "subject_intent": "confirmed",
        "answered_by": "human",
        "confidence_note": "note" + ESC + "[2J" + "A" * 100000,
    }
    snapshot = dict(raw)
    verdict = reconcile(raw, {"if_confirmed": "KEEP_SLOT", "if_cancelled": "RELEASE_SLOT"}, matrix)
    assert verdict.status == "RESOLVED"
    assert verdict.action == "KEEP_SLOT"
    assert raw == snapshot  # reconcile neither sanitized nor mutated its input


def test_sanitize_is_idempotent() -> None:
    for value in [ESC + "[2Jx", "A" * 100000, "ordinary text", chr(0) + chr(127) + chr(0x9B)]:
        once = sanitize_for_display(value)
        assert once == sanitize_for_display(once) == sanitize_for_display(sanitize_for_display(once))


def test_sanitize_never_exceeds_its_limit() -> None:
    """The truncation marker counts inside the budget, never on top of it -
    otherwise the output would exceed the limit and re-truncate forever.
    """
    for limit in (16, 128, MAX_DISPLAY_CHARS):
        assert len(sanitize_for_display("A" * 100000, limit)) <= limit


def test_hostile_error_code_cannot_inject_terminal_sequences(monkeypatch, capsys) -> None:
    """Requirement 6, on the retry log path: a hostile error.code returned
    with a retryable status on a GET must not reach stdout raw.
    """
    import email.message
    import io
    import json
    import urllib.error

    hostile_code = "rate_limit" + ESC + "[2J" + ESC + "[31mPWNED"
    state = {"n": 0}

    def fake_urlopen(request, timeout=None):
        state["n"] += 1
        if state["n"] == 1:
            body = json.dumps({"error": {"code": hostile_code, "message": "x"}}).encode()
            raise urllib.error.HTTPError(
                "http://fake/v1/calls/x", 429, "Too Many", email.message.Message(), io.BytesIO(body)
            )

        class _Response:
            status = 200

            def read(self):
                return b'{"id":"call_x","status":"completed"}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        return _Response()

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(client_module.time, "sleep", lambda seconds: None)

    CallEClient(base_url="http://fake", api_key=TEST_API_KEY).get_call("call_x")

    out = capsys.readouterr().out
    assert ESC not in out
    assert "retryable" in out
    assert "PWNED" in out  # content still readable, just neutralized


def test_connection_error_reason_is_sanitized(monkeypatch, capsys) -> None:
    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise urllib.error.URLError("refused" + ESC + "[2J")

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(client_module.time, "sleep", lambda seconds: None)

    with pytest.raises(RuntimeError):
        CallEClient(base_url="http://fake", api_key=TEST_API_KEY).get_call("call_x")

    assert ESC not in capsys.readouterr().out


def test_verdict_evidence_line_is_bounded_at_display_time() -> None:
    """The Verdict object keeps citing what the provider really returned,
    but resolver.print_verdict bounds each line before it reaches a
    terminal. Proves the split: raw for the record, bounded for display.
    """
    from datetime import timedelta

    import resolver
    from evidence.model import Ambiguity, Evidence, EvidenceMatrix, EvidenceType
    from verdict import reconcile

    matrix = EvidenceMatrix(
        (Evidence("calendar", EvidenceType.STRUCTURED, timedelta(hours=1), "ok", Ambiguity.LOW),)
    )
    verdict = reconcile(
        {"subject_intent": "X" * 100000 + ESC, "answered_by": "human"},
        {"if_confirmed": "KEEP_SLOT", "if_cancelled": "RELEASE_SLOT"},
        matrix,
    )
    long_line = next(item for item in verdict.evidence_cited if "CALL-E result" in item)
    assert len(long_line) > MAX_DISPLAY_CHARS  # the Verdict itself stays unbounded

    import io
    from contextlib import redirect_stdout

    buffer = io.StringIO()
    with redirect_stdout(buffer):
        resolver.print_verdict(verdict)
    printed = buffer.getvalue()

    assert ESC not in printed
    for line in printed.splitlines():
        assert len(line) <= MAX_DISPLAY_CHARS + 10  # + the "    - " prefix
