import pytest

from pipeline.guardrails import (
    BudgetExceeded,
    CallGuardrails,
    GuardrailViolation,
    LLMBudgetGuard,
    normalize_phone,
    redact_phone_number,
)


def test_normalize_phone_strips_formatting_and_keeps_last_ten_digits():
    assert normalize_phone("+1 (800) 555-0187") == normalize_phone("(800) 555-0187") == "8005550187"


# --- redact_phone_number ---


@pytest.mark.parametrize(
    "rendering",
    [
        "+447700900000",
        "07700900000",
        "+44 7700 900 000",
        "(0770) 090-0000",
        "0770.090.0000",
        "44 7700900000",
    ],
)
def test_redact_phone_number_catches_common_transcript_renderings(rendering):
    transcript = f"Caller: you can reach us back on {rendering} anytime."
    redacted = redact_phone_number(transcript, "+447700900000")
    assert rendering not in redacted
    assert "[phone number redacted]" in redacted


def test_redact_phone_number_leaves_unrelated_numbers_alone():
    transcript = "Caller: your case reference is 12345678."
    assert redact_phone_number(transcript, "+447700900000") == transcript


def test_redact_phone_number_handles_transcript_with_no_match():
    transcript = "Caller: I can't share any details right now."
    assert redact_phone_number(transcript, "+447700900000") == transcript


# --- CallGuardrails ---


def test_unrestricted_mode_allows_any_number(tmp_path):
    g = CallGuardrails(allowed_numbers=None, state_path=tmp_path / "state.json")
    g.check("+18005550187")  # should not raise


def test_allowlist_blocks_numbers_not_on_it(tmp_path):
    g = CallGuardrails(allowed_numbers={"+18005550187"}, state_path=tmp_path / "state.json")
    with pytest.raises(GuardrailViolation, match="allowlist"):
        g.check("+19995550000")


def test_allowlist_permits_numbers_on_it(tmp_path):
    g = CallGuardrails(allowed_numbers={"+18005550187"}, state_path=tmp_path / "state.json")
    g.check("+18005550187")  # should not raise


def test_blocks_redialing_the_same_number(tmp_path):
    g = CallGuardrails(allowed_numbers=None, state_path=tmp_path / "state.json")
    g.check("+18005550187")
    g.record_call("+18005550187")
    with pytest.raises(GuardrailViolation, match="already screened"):
        g.check("+18005550187")


def test_call_cap_is_enforced(tmp_path):
    g = CallGuardrails(allowed_numbers=None, max_calls=2, state_path=tmp_path / "state.json")
    g.check("+11111111111")
    g.record_call("+11111111111")
    g.check("+12222222222")
    g.record_call("+12222222222")
    with pytest.raises(GuardrailViolation, match="budget"):
        g.check("+13333333333")


def test_call_state_persists_across_instances(tmp_path):
    state_path = tmp_path / "state.json"
    CallGuardrails(allowed_numbers=None, state_path=state_path).record_call("+18005550187")
    g2 = CallGuardrails(allowed_numbers=None, state_path=state_path)
    with pytest.raises(GuardrailViolation, match="already screened"):
        g2.check("+18005550187")


# --- LLMBudgetGuard ---


def test_budget_check_passes_when_nothing_spent(tmp_path):
    LLMBudgetGuard(daily_limit_usd=1.0, state_path=tmp_path / "budget.json").check()


def test_record_usage_computes_cost_from_sonnet_pricing(tmp_path):
    budget = LLMBudgetGuard(daily_limit_usd=100.0, state_path=tmp_path / "budget.json")
    # 1,000,000 input tokens @ $3/MTok + 1,000,000 output tokens @ $15/MTok = $18
    cost = budget.record_usage("claude-sonnet-5", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == pytest.approx(18.0)


def test_budget_blocks_once_daily_limit_is_reached(tmp_path):
    budget = LLMBudgetGuard(daily_limit_usd=0.01, state_path=tmp_path / "budget.json")
    budget.record_usage("claude-sonnet-5", input_tokens=100_000, output_tokens=100_000)
    with pytest.raises(BudgetExceeded, match="Daily LLM budget"):
        budget.check()


def test_budget_persists_across_instances(tmp_path):
    state_path = tmp_path / "budget.json"
    LLMBudgetGuard(daily_limit_usd=0.01, state_path=state_path).record_usage(
        "claude-sonnet-5", input_tokens=100_000, output_tokens=100_000
    )
    with pytest.raises(BudgetExceeded):
        LLMBudgetGuard(daily_limit_usd=0.01, state_path=state_path).check()


def test_unknown_model_falls_back_to_default_pricing(tmp_path):
    budget = LLMBudgetGuard(daily_limit_usd=100.0, state_path=tmp_path / "budget.json")
    cost = budget.record_usage("some-future-model", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == pytest.approx(18.0)  # same as claude-sonnet-5, the documented default
