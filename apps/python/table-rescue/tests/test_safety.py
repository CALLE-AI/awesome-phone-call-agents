from unittest import mock
import re

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from table_rescue.safety import (
    RunSafety,
    SafetyViolation,
    load_authorizations,
    mask_phone,
    missing_authorizations,
    sanitize_text,
    validate_destination,
    validate_origin,
    validate_phone_syntax,
)


class TestSyntax:
    def test_accepts_valid_e164(self):
        validate_phone_syntax("+14155550100")
        validate_phone_syntax("+18005550187")

    @pytest.mark.parametrize(
        "phone",
        ["", "14155550100", "+04155550100", "+1 415 555 0100", "+1415555010?",
        "0012345", "+abc", "+14155550100\n",
        # Unicode decimal digits must never pass ASCII-strict E.164.
        "+84１２３４５６７", "+8٤١٢٣٤٥٦٧", "+84९८७६५४३२"],
    )
    def test_rejects_non_e164(self, phone):
        with pytest.raises(SafetyViolation, match="INVALID_E164"):
            validate_phone_syntax(phone)


class TestRegionRules:
    def test_us_test_hotline_passes(self):
        # Reserved 555-01xx numbers are (correctly) refused by the fictional
        # gate below, so the live pass path is exercised with a standards-reserved fictional number
        # (patched for live path testing).
        with mock.patch("table_rescue.safety._is_fictional_nanp", return_value=False):
            validate_destination("+14155550132", region="US", live=True)

    def test_region_lookup_is_case_insensitive(self):
        with mock.patch("table_rescue.safety._is_fictional_nanp", return_value=False):
            validate_destination("+14155550132", region="us", live=True)

    def test_wrong_prefix_rejected(self):
        with pytest.raises(SafetyViolation, match="REGION_MISMATCH"):
            validate_destination("+14155550100", region="SG", live=True)

    def test_bad_national_length_rejected(self):
        with pytest.raises(SafetyViolation, match="INVALID_LENGTH"):
            validate_destination("+84155500", region="VN", live=True)

    def test_unsupported_region_rejected(self):
        with pytest.raises(SafetyViolation, match="UNSUPPORTED_REGION"):
            validate_destination("+14155550100", region="XX", live=True)

    def test_dry_run_skips_region_rules(self):
        validate_destination("+15550101", region=None, live=False)


class TestFictionalBlock:
    def test_short_sample_form_rejected_live(self):
        with pytest.raises(SafetyViolation, match="FICTIONAL_NUMBER"):
            validate_destination("+15550101", region="US", live=True)

    def test_full_npa_555_rejected_live(self):
        with pytest.raises(SafetyViolation, match="FICTIONAL_NUMBER"):
            validate_destination("+15552125501", region="US", live=True)

    def test_full_555_01xx_block_rejected_live(self):
        with pytest.raises(SafetyViolation, match="FICTIONAL_NUMBER"):
            validate_destination("+12125550199", region="US", live=True)

    def test_live_pass_path_uses_call_e_test_hotline(self):
        # a standards-reserved fictional number (patched for live path testing).
        with mock.patch("table_rescue.safety._is_fictional_nanp", return_value=False):
            validate_destination("+14155550132", region="US", live=True)
    def test_fictional_allowed_in_dry_run(self):
        validate_destination("+15550101", region=None, live=False)


class TestOrigin:
    def test_official_origin_passes(self):
        validate_origin("https://seleven-mcp-sg.airudder.com")
        validate_origin("https://seleven-mcp-sg.airudder.com/")

    @pytest.mark.parametrize(
        "origin",
        [
            "http://seleven-mcp-sg.airudder.com",
            "https://evil.example.com",
            "https://seleven-mcp-sg.airudder.com.evil.com",
            "",
        ],
    )
    def test_other_origins_rejected(self, origin):
        with pytest.raises(SafetyViolation, match="ORIGIN_NOT_ALLOWED"):
            validate_origin(origin)


class TestAuthorization:
    def test_load_and_missing(self, tmp_path):
        path = tmp_path / "authorized_destinations.jsonl"
        path.write_text(
            '{"phone": "+14155550100", "name": "Guest", '
            '"authorized_by": "op", "authorized_at": "2026-09-07T00:00:00+07:00"}\n',
            encoding="utf-8",
        )
        authorizations = load_authorizations(path)
        assert missing_authorizations(["+14155550100"], authorizations) == []
        assert missing_authorizations(
            ["+14155550100", "+14155550190"], authorizations
        ) == ["+14155550190"]

    def test_duplicate_rows_rejected(self, tmp_path):
        path = tmp_path / "authorized_destinations.jsonl"
        row = '{"phone": "+14155550100", "authorized_by": "op"}\n'
        path.write_text(row + row, encoding="utf-8")
        with pytest.raises(SafetyViolation, match="DUPLICATE_AUTHORIZATION"):
            load_authorizations(path)

    def test_malformed_json_line_rejected(self, tmp_path):
        path = tmp_path / "authorized_destinations.jsonl"
        path.write_text("not json\n", encoding="utf-8")
        with pytest.raises(SafetyViolation, match="INVALID_AUTHORIZATION_FILE"):
            load_authorizations(path)

    def test_row_missing_phone_rejected(self, tmp_path):
        path = tmp_path / "authorized_destinations.jsonl"
        path.write_text('{"name": "Guest"}\n', encoding="utf-8")
        with pytest.raises(SafetyViolation, match="INVALID_AUTHORIZATION_FILE"):
            load_authorizations(path)


class TestSanitize:
    def test_masks_e164_and_separated_forms(self):
        masked = sanitize_text("call +14155550100 now")
        assert "+14155550100" not in masked
        assert mask_phone("+14155550100") in masked
        assert masked.endswith("now")

    def test_masks_local_separated_forms(self):
        masked = sanitize_text("said (415) 555-0100 twice")
        assert "415" not in masked
        assert "555" not in masked
        assert masked.endswith("00 twice")

    def test_masks_comma_and_slash_grouped_forms(self):
        masked = sanitize_text("dialed +1,415,555,0100 then 415/555/0100")
        assert "415" not in masked
        assert "555" not in masked

    def test_masks_unicode_digit_runs(self):
        masked = sanitize_text("number +８４９００００００００ there")
        assert "８４" not in masked

    def test_short_digit_runs_untouched(self):
        assert sanitize_text("party of 4 at 19:00") == "party of 4 at 19:00"

    def test_idempotent_and_empty_safe(self):
        text = "call +14155550100 or 415 555 0100"
        once = sanitize_text(text)
        assert sanitize_text(once) == once
        assert sanitize_text(None) == ""
        assert sanitize_text("") == ""


class TestMaskedViolations:
    def test_invalid_e164_message_masks_input(self):
        with pytest.raises(SafetyViolation) as exc:
            validate_phone_syntax("+1 415 555 0100")
        assert "+1 415 555 0100" not in str(exc.value)
        assert mask_phone("+1 415 555 0100") in str(exc.value)

    def test_region_mismatch_message_masks_phone(self):
        with pytest.raises(SafetyViolation) as exc:
            validate_destination("+14155550100", region="SG", live=True)
        assert "+14155550100" not in str(exc.value)
        assert mask_phone("+14155550100") in str(exc.value)

    def test_not_authorized_message_masks_phone(self):
        with pytest.raises(SafetyViolation) as exc:
            RunSafety(live=True, region="US", authorizations={}).check_destination(
                "+14155550132"
            )
        assert "+14155550132" not in str(exc.value)


class TestRunSafety:
    def test_dry_run_is_noop(self):
        RunSafety(live=False).check_destination("+15550101")

    def test_live_requires_region(self):
        with pytest.raises(SafetyViolation, match="MISSING_REGION"):
            RunSafety(live=True, region=None).check_destination("+14155550132")

    def test_live_happy_path(self):
        safety = RunSafety(
            live=True,
            region="US",
            authorizations={"+14155550132": {"authorized_by": "op"}},
        )
        with mock.patch("table_rescue.safety._is_fictional_nanp", return_value=False):
            safety.check_destination("+14155550132")

    def test_live_unauthorized_rejected(self):
        safety = RunSafety(live=True, region="US", authorizations={})
        with mock.patch("table_rescue.safety._is_fictional_nanp", return_value=False):
            with pytest.raises(SafetyViolation, match="NOT_AUTHORIZED"):
                safety.check_destination("+14155550132")


@given(
    st.text(
        alphabet=st.characters(blacklist_categories=("Cs",)),
        min_size=0,
        max_size=18,
    )
)
@settings(max_examples=200, deadline=None)
def test_arbitrary_text_is_never_a_valid_destination(text):
    assume(text != "")
    try:
        validate_phone_syntax(text)
    except SafetyViolation:
        return
    # Anything accepted must satisfy the ASCII-strict E.164 grammar itself.
    assert re.fullmatch(r"\+[1-9][0-9]{6,14}", text) is not None
