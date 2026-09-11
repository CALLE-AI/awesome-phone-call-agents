import pytest

from pipeline.caller import CallEClient, CallResult, RealCallEClient
from pipeline.guardrails import CallGuardrails, GuardrailViolation
from pipeline.models import CallMetadata
from pipeline.orchestrator import RecipientMismatch, run_pipeline

EMAIL_BODY = (
    "Subject: Unusual Activity Detected\n\n"
    "We detected unusual activity on your account. Call (800) 555-0187 now to avoid suspension."
)


class FakeCallClient(CallEClient):
    """Records the phone_number it was actually asked to dial, and returns a
    pre-built result (or raises, to simulate an ambiguous/failed call)."""

    def __init__(self, result: CallResult | None = None, raises: Exception | None = None):
        self.result = result
        self.raises = raises
        self.dialed_numbers: list[str] = []

    def place_screening_call(self, phone_number, task, result_schema=None):
        self.dialed_numbers.append(phone_number)
        if self.raises:
            raise self.raises
        return self.result


def _completed_result(number_dialed: str) -> CallResult:
    return CallResult(
        transcript="a real conversation happened",
        metadata=CallMetadata(number_dialed=number_dialed, duration_seconds=30, timestamp="now", status="COMPLETED"),
    )


def test_dials_the_confirmed_to_phone_not_the_loosely_formatted_extracted_text():
    client = FakeCallClient(result=_completed_result("+18005550187"))
    run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")
    assert client.dialed_numbers == ["+18005550187"]


def test_falls_back_to_extracted_number_when_to_phone_omitted():
    # This is the --demo/preview path, which never dials for real — the raw
    # extracted text is fine there since nothing is actually called.
    client = FakeCallClient(result=_completed_result("(800) 555-0187"))
    run_pipeline(EMAIL_BODY, "example.com", client)
    assert client.dialed_numbers == ["(800) 555-0187"]


def test_skips_tagging_entirely_when_answered_by_machine():
    # score() discards any tags when answered_by_machine is set (see
    # test_scoring.py), so tagging first would only spend real LLM budget on
    # a result that's thrown away — this asserts the tagger is never called.
    result = CallResult(
        transcript="a real conversation happened",
        metadata=CallMetadata(
            number_dialed="+18005550187",
            duration_seconds=30,
            timestamp="now",
            status="COMPLETED",
            answered_by_machine=True,
        ),
    )
    client = FakeCallClient(result=result)

    def _tagger_that_must_not_be_called(transcript, catalog):
        raise AssertionError("tagger should not be called when answered_by_machine is True")

    screening = run_pipeline(
        EMAIL_BODY, "example.com", client, to_phone="+18005550187", tagger=_tagger_that_must_not_be_called
    )
    assert screening.verdict == "inconclusive"


def test_recipient_binding_mismatch_raises_instead_of_scoring():
    # The call result claims a different number was dialed than requested —
    # must never silently score a verdict against the wrong recipient.
    client = FakeCallClient(result=_completed_result("+19995550199"))
    with pytest.raises(RecipientMismatch, match="mismatched recipient"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")


def test_recipient_binding_does_not_alias_across_country_codes():
    # "+447700900187" and "+17700900187" share the same last-10-digit
    # suffix but are different E.164 destinations (different country
    # codes) - normalize_phone's truncated comparison used to treat them
    # as equal. The binding check must still catch this as a mismatch.
    client = FakeCallClient(result=_completed_result("+447700900187"))
    with pytest.raises(RecipientMismatch, match="mismatched recipient"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+17700900187")


@pytest.mark.parametrize(
    "reported_rendering",
    ["18005550187", "+1 800 555 0187", "+1-800-555-0187"],
)
def test_recipient_binding_tolerates_calle_formatting_a_real_match_differently(reported_rendering):
    # CALL-E's own report of the dialed number may not be formatted exactly
    # like our own validated E.164 string (no "+", different separators)
    # even when it's genuinely the same real number, and every rendering
    # here still carries the full country code. An exact-string comparison
    # would discard a real, completed call's transcript over formatting
    # alone and permanently mark the number as an unresolved attempt -
    # full_digits_match must tolerate this.
    client = FakeCallClient(result=_completed_result(reported_rendering))
    result = run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")
    assert result is not None


def test_recipient_binding_still_rejects_a_report_missing_the_country_code():
    # "(800) 555-0187" has no country code at all - unlike the renderings
    # above, this is genuinely ambiguous (it could be the same number
    # written carelessly, or the national number of a different country's
    # destination entirely), so this must still fail closed rather than
    # guess it's a match.
    client = FakeCallClient(result=_completed_result("(800) 555-0187"))
    with pytest.raises(RecipientMismatch, match="mismatched recipient"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")


def test_record_attempt_fires_before_dialing_so_a_crash_still_blocks_redial(tmp_path):
    guardrails = CallGuardrails(
        allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json"
    )
    client = FakeCallClient(raises=RuntimeError("simulated ambiguous timeout"))

    with pytest.raises(RuntimeError, match="simulated ambiguous timeout"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187", guardrails=guardrails)

    # A fresh instance reading the same state file must still see the
    # in-progress attempt, even though place_screening_call never returned.
    guardrails_after_crash = CallGuardrails(
        allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json"
    )
    with pytest.raises(GuardrailViolation, match="unknown outcome"):
        guardrails_after_crash.check("+18005550187")


def test_real_client_without_guardrails_fails_closed_at_the_library_boundary():
    # A caller integrating this library directly (not through screen.py)
    # who supplies a real, dialing client but forgets guardrails would
    # otherwise dial with no allowlist, no repeat-dial protection, and no
    # call cap. This must refuse before ever touching the client — no
    # subprocess/network mocking needed since it should never get that far.
    with pytest.raises(GuardrailViolation, match="without guardrails"):
        run_pipeline(EMAIL_BODY, "example.com", RealCallEClient(), to_phone="+18005550187")


def test_mock_client_without_guardrails_is_fine():
    # The --demo/preview path legitimately has no guardrails and must not
    # be affected by the RealCallEClient-specific check above.
    client = FakeCallClient(result=_completed_result("+18005550187"))
    result = run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")
    assert result is not None


def test_record_call_only_fires_after_a_successful_result(tmp_path):
    guardrails = CallGuardrails(
        allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json"
    )
    client = FakeCallClient(result=_completed_result("+18005550187"))
    run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187", guardrails=guardrails)

    # Blocked by "already screened" (success path), not "unknown outcome".
    with pytest.raises(GuardrailViolation, match="already screened"):
        guardrails.check("+18005550187")
