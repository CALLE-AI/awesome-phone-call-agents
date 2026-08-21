import pytest

from pipeline.caller import CallEClient, CallResult, RealCallEClient
from pipeline.guardrails import CallGuardrails, GuardrailViolation
from pipeline.models import CallMetadata
from pipeline.orchestrator import run_pipeline

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


def test_recipient_binding_mismatch_raises_instead_of_scoring():
    # The call result claims a different number was dialed than requested —
    # must never silently score a verdict against the wrong recipient.
    client = FakeCallClient(result=_completed_result("+19995550199"))
    with pytest.raises(RuntimeError, match="mismatched recipient"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+18005550187")


def test_recipient_binding_does_not_alias_across_country_codes():
    # "+447700900187" and "+17700900187" share the same last-10-digit
    # suffix but are different E.164 destinations (different country
    # codes) - normalize_phone's truncated comparison used to treat them
    # as equal. The binding check must still catch this as a mismatch.
    client = FakeCallClient(result=_completed_result("+447700900187"))
    with pytest.raises(RuntimeError, match="mismatched recipient"):
        run_pipeline(EMAIL_BODY, "example.com", client, to_phone="+17700900187")


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
