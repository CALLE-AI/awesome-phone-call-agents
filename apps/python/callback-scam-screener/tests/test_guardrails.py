import pytest

from pipeline.guardrails import (
    BudgetExceeded,
    CallGuardrails,
    GuardrailViolation,
    LLMBudgetGuard,
    find_unsafe_phone_numbers,
    full_digits_match,
    is_valid_e164,
    mask_phone_number,
    normalize_phone,
    redact_phone_number,
)


# Ofcom's officially reserved UK mobile drama/fiction range (07700 900000-
# 900999) — guaranteed never to belong to a real subscriber. Always use this
# constant rather than a literal in any new test: a real number was
# accidentally used here once already (caught and scrubbed from history).
FICTIONAL_UK_MOBILE = "+447700900000"


def test_normalize_phone_strips_formatting_and_keeps_last_ten_digits():
    assert normalize_phone("+1 (800) 555-0187") == normalize_phone("(800) 555-0187") == "8005550187"


# --- redact_phone_number ---


@pytest.mark.parametrize(
    "rendering",
    [
        FICTIONAL_UK_MOBILE,
        "07700900000",
        "+44 7700 900 000",
        "(0770) 090-0000",
        "0770.090.0000",
        "44 7700900000",
    ],
)
def test_redact_phone_number_catches_common_transcript_renderings(rendering):
    transcript = f"Caller: you can reach us back on {rendering} anytime."
    redacted = redact_phone_number(transcript, FICTIONAL_UK_MOBILE)
    assert rendering not in redacted
    assert "[phone number redacted]" in redacted


def test_redact_phone_number_leaves_unrelated_numbers_alone():
    transcript = "Caller: your case reference is 12345678."
    assert redact_phone_number(transcript, FICTIONAL_UK_MOBILE) == transcript


def test_redact_phone_number_handles_transcript_with_no_match():
    transcript = "Caller: I can't share any details right now."
    assert redact_phone_number(transcript, FICTIONAL_UK_MOBILE) == transcript


# --- CallGuardrails ---


def test_no_allowlist_and_not_unrestricted_fails_closed(tmp_path):
    with pytest.raises(GuardrailViolation, match="unrestricted"):
        CallGuardrails(allowed_numbers=None, state_path=tmp_path / "state.json")


def test_unrestricted_mode_allows_any_number(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.check("+18005550187")  # should not raise


def test_allowlist_blocks_numbers_not_on_it(tmp_path):
    g = CallGuardrails(allowed_numbers={"+18005550187"}, state_path=tmp_path / "state.json")
    with pytest.raises(GuardrailViolation, match="allowlist"):
        g.check("+19995550199")


def test_allowlist_permits_numbers_on_it(tmp_path):
    g = CallGuardrails(allowed_numbers={"+18005550187"}, state_path=tmp_path / "state.json")
    g.check("+18005550187")  # should not raise


def test_non_e164_number_is_refused(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    with pytest.raises(GuardrailViolation, match="E.164"):
        g.check("(800) 555-0187")


def test_allowlist_construction_rejects_non_e164_entries(tmp_path):
    with pytest.raises(GuardrailViolation, match="E.164"):
        CallGuardrails(allowed_numbers={"(800) 555-0187"}, state_path=tmp_path / "state.json")


def test_allowlist_does_not_alias_across_country_codes(tmp_path):
    # Both numbers below share the same last-10-digit suffix (the Ofcom
    # reserved mobile core "7700900123") but have different country codes,
    # so they are genuinely different E.164 destinations. Before switching
    # to exact-string matching, normalize_phone's last-10-digits comparison
    # would have let country_b_number alias its way past an allowlist that
    # only contained country_a_number.
    country_a_number = "+17700900123"
    country_b_number = "+447700900123"
    g = CallGuardrails(allowed_numbers={country_a_number}, state_path=tmp_path / "state.json")
    g.check(country_a_number)  # should not raise - exact allowlist match
    with pytest.raises(GuardrailViolation, match="allowlist"):
        g.check(country_b_number)  # different destination - must not alias in


def test_already_screened_check_does_not_alias_across_country_codes(tmp_path):
    country_a_number = "+17700900123"
    country_b_number = "+447700900123"
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.record_call(country_a_number)
    g.check(country_b_number)  # a genuinely different number - should not raise


def test_allowlist_check_ignores_incidental_whitespace(tmp_path):
    # is_valid_e164() strips before matching, so "+18005550187 " (trailing
    # space) individually validates - but without canonicalizing before the
    # exact-match comparison too, it would compare as a *different* key than
    # "+18005550187", letting the same real number be dialed twice under the
    # exact-match scheme meant to prevent exactly that.
    g = CallGuardrails(allowed_numbers={"+18005550187 "}, state_path=tmp_path / "state.json")
    g.check("+18005550187")  # should not raise despite the allowlist entry's trailing space


def test_already_screened_check_ignores_incidental_whitespace(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.record_call(" +18005550187")  # leading space
    with pytest.raises(GuardrailViolation, match="already screened"):
        g.check("+18005550187")  # no space - must still be recognized as the same number


def test_blocks_redialing_the_same_number(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.check("+18005550187")
    g.record_call("+18005550187")
    with pytest.raises(GuardrailViolation, match="already screened"):
        g.check("+18005550187")


def test_attempted_but_unresolved_number_blocks_redial(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.check("+18005550187")
    g.record_attempt("+18005550187")  # no record_call — outcome unknown, e.g. an ambiguous timeout
    with pytest.raises(GuardrailViolation, match="unknown outcome"):
        g.check("+18005550187")


def test_record_call_clears_the_attempt_marker(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=tmp_path / "state.json")
    g.record_attempt("+18005550187")
    g.record_call("+18005550187")
    with pytest.raises(GuardrailViolation, match="already screened"):
        g.check("+18005550187")  # blocked by "already screened", not "unknown outcome"


def test_call_cap_is_enforced(tmp_path):
    g = CallGuardrails(allowed_numbers=None, unrestricted=True, max_calls=2, state_path=tmp_path / "state.json")
    g.check("+11111111111")
    g.record_call("+11111111111")
    g.check("+12222222222")
    g.record_call("+12222222222")
    with pytest.raises(GuardrailViolation, match="budget"):
        g.check("+13333333333")


def test_call_state_persists_across_instances(tmp_path):
    state_path = tmp_path / "state.json"
    CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=state_path).record_call("+18005550187")
    g2 = CallGuardrails(allowed_numbers=None, unrestricted=True, state_path=state_path)
    with pytest.raises(GuardrailViolation, match="already screened"):
        g2.check("+18005550187")


# --- is_valid_e164 ---


@pytest.mark.parametrize("valid_number", ["+18005550187", FICTIONAL_UK_MOBILE, "+442079460000"])
def test_is_valid_e164_accepts_well_formed_numbers(valid_number):
    assert is_valid_e164(valid_number)


@pytest.mark.parametrize(
    "invalid_number",
    ["(800) 555-0187", "8005550187", "+0000000000", "+1", "not a number"],
)
def test_is_valid_e164_rejects_malformed_numbers(invalid_number):
    assert not is_valid_e164(invalid_number)


# --- mask_phone_number ---


def test_mask_phone_number_hides_all_but_last_two_digits():
    masked = mask_phone_number("Call me at +18005550187 anytime.", "+18005550187")
    assert "18005550187" not in masked
    assert masked.endswith("87 anytime.")
    assert "*" in masked


def test_mask_phone_number_leaves_unrelated_text_alone():
    text = "Caller: your case reference is 12345678."
    assert mask_phone_number(text, "+18005550187") == text


def test_mask_phone_number_consumes_a_leading_open_paren():
    # Regression: "(800) 555-0187" used to leave a stray "(" in front of the
    # mask because the leading paren wasn't part of the matched substring.
    masked = mask_phone_number("(800) 555-0187", "(800) 555-0187")
    assert not masked.startswith("(")
    assert masked.endswith("87")


def test_redact_phone_number_consumes_a_leading_open_paren():
    redacted = redact_phone_number("(800) 555-0187", "(800) 555-0187")
    assert redacted == "[phone number redacted]"


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


# --- find_unsafe_phone_numbers / reserved-range precision ---


@pytest.mark.parametrize("reserved", ["+18005550100", "+18005550187", "+18005550199"])
def test_reserved_nanp_range_is_recognized_as_safe(reserved):
    assert find_unsafe_phone_numbers(f"call {reserved} now") == []


def test_nanp_555_exchange_outside_the_reserved_block_is_flagged():
    # NANP 555-01XX is the actual reserved block. The pattern used to match
    # the whole 555-0XXX exchange, which would have let a real, assignable
    # exchange number through as "safe". Built at runtime rather than as a
    # literal in this file, so this test's own source doesn't itself trip
    # the repo-wide unsafe-number scan (test_no_real_phone_numbers.py) —
    # the whole point here is a number that *should* be flagged.
    non_reserved = "+1800555" + "0" + "500"
    flagged = find_unsafe_phone_numbers(f"call {non_reserved} now")
    assert flagged == [non_reserved]


# --- full_digits_match ---


@pytest.mark.parametrize(
    "rendering",
    ["+18005550187", "18005550187", "+1 800 555 0187", "+1-800-555-0187", "(1) 800-555-0187"],
)
def test_full_digits_match_tolerates_formatting_of_the_same_full_number(rendering):
    assert full_digits_match(rendering, "+18005550187")


def test_full_digits_match_rejects_a_number_missing_the_country_code():
    # "(800) 555-0187" has no country code at all - genuinely ambiguous,
    # not just differently formatted, so this must not match.
    assert not full_digits_match("(800) 555-0187", "+18005550187")


def test_full_digits_match_does_not_alias_across_country_codes():
    # Unlike normalize_phone's last-10-digits form, comparing the complete
    # digit sequence must still tell these two different countries' numbers
    # apart even though they share the same last 10 digits.
    assert not full_digits_match("+447700900123", "+17700900123")
