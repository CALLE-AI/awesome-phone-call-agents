"""Destination authorization, phone masking, and credential-target pinning."""
import pytest

from refcheck.client import (
    DEFAULT_BASE_URL,
    CredentialTargetError,
    build_request,
    place_call,
    resolve_base_url,
)
from refcheck.phone import (
    DestinationError,
    allowlist,
    assert_authorized,
    mask,
    mask_all,
    normalize_e164,
)
from refcheck.templates import TEMPLATES

GOOD = "+15555550142"
OTHER = "+15555550188"


class TestE164Validation:
    @pytest.mark.parametrize("value", [GOOD, "+442071838750", "+81312345678", " +15555550142 "])
    def test_accepts_valid_ascii_e164(self, value):
        assert normalize_e164(value) == value.strip()

    @pytest.mark.parametrize(
        "value",
        [
            "5555550142",            # no plus
            "+0155550142",           # country code starts with 0
            "+1555555",              # too short
            "+1555555014255555",     # too long
            "+1 555 555 0142",       # spaces
            "+1-555-555-0142",       # hyphens
            "+1 (555) 555-0142",     # parentheses
            "+1555555014a",          # letter
            "",
            "   ",
        ],
    )
    def test_rejects_malformed(self, value):
        with pytest.raises(DestinationError):
            normalize_e164(value)

    @pytest.mark.parametrize(
        "value",
        [
            "+١٥٥٥٥٥٥٠١٤٢",          # Arabic-Indic digits
            "＋15555550142",          # fullwidth plus
            "+１５５５５５５０１４２",   # fullwidth digits
            "+1555555​0142",     # zero-width space
            "‒1555550142",       # figure dash instead of plus
        ],
    )
    def test_rejects_non_ascii_rather_than_transliterating(self, value):
        """A confusable digit is a different destination, so refuse it."""
        with pytest.raises(DestinationError) as exc:
            normalize_e164(value)
        assert "ASCII" in str(exc.value)

    def test_non_string_input_is_rejected(self):
        with pytest.raises(DestinationError):
            normalize_e164(15555550142)


class TestOperatorAuthorization:
    def test_empty_allowlist_authorizes_nothing(self, monkeypatch):
        """A misconfigured deployment must place no calls, not every call."""
        monkeypatch.delenv("REFCHECK_ALLOWED_DESTINATIONS", raising=False)
        with pytest.raises(DestinationError) as exc:
            assert_authorized(GOOD)
        assert "No destinations are authorized" in str(exc.value)

    def test_blank_allowlist_authorizes_nothing(self, monkeypatch):
        monkeypatch.setenv("REFCHECK_ALLOWED_DESTINATIONS", "  , ,")
        with pytest.raises(DestinationError):
            assert_authorized(GOOD)

    def test_number_on_the_allowlist_is_permitted(self, monkeypatch):
        monkeypatch.setenv("REFCHECK_ALLOWED_DESTINATIONS", f"{GOOD},{OTHER}")
        assert assert_authorized(GOOD) == GOOD

    def test_number_off_the_allowlist_is_refused(self, monkeypatch):
        monkeypatch.setenv("REFCHECK_ALLOWED_DESTINATIONS", OTHER)
        with pytest.raises(DestinationError) as exc:
            assert_authorized(GOOD)
        assert "not in REFCHECK_ALLOWED_DESTINATIONS" in str(exc.value)

    def test_allowlist_entries_are_themselves_validated(self, monkeypatch):
        monkeypatch.setenv("REFCHECK_ALLOWED_DESTINATIONS", "555-0142")
        with pytest.raises(DestinationError):
            allowlist()

    def test_refusal_message_does_not_leak_the_full_number(self, monkeypatch):
        monkeypatch.setenv("REFCHECK_ALLOWED_DESTINATIONS", OTHER)
        with pytest.raises(DestinationError) as exc:
            assert_authorized(GOOD)
        assert GOOD not in str(exc.value)

    def test_place_call_refuses_before_touching_the_network(self, monkeypatch, candidate):
        """No API key is set, so reaching the client would raise a different error."""
        monkeypatch.delenv("REFCHECK_ALLOWED_DESTINATIONS", raising=False)
        monkeypatch.delenv("CALLE_API_KEY", raising=False)
        reference = {
            "id": "r1",
            "referee_name": "Jordan Referee",
            "referee_phone": GOOD,
            "relationship": "Former direct manager",
        }
        with pytest.raises(DestinationError):
            place_call(reference, candidate, TEMPLATES["standard"])


class TestMasking:
    def test_keeps_country_code_and_last_four(self):
        assert mask(GOOD) == "+1******0142"  # 11 digits: keep first + last 4

    def test_never_returns_the_full_number(self):
        for value in (GOOD, OTHER, "+442071838750"):
            assert mask(value) != value
            assert value not in mask(value)

    def test_distinguishes_two_numbers(self):
        assert mask(GOOD) != mask(OTHER)

    def test_short_or_invalid_values_are_fully_hidden(self):
        assert "5550142" not in mask("5550142")
        assert mask("") == "<empty>"
        assert mask(None) == "<invalid>"

    def test_mask_all_redacts_numbers_inside_free_text(self):
        text = f"Calling {GOOD} now, fallback {OTHER}."
        out = mask_all(text)
        assert GOOD not in out and OTHER not in out
        assert "Calling" in out and "fallback" in out

    def test_mask_all_leaves_non_phone_text_alone(self):
        assert mask_all("score 9.1 of 10") == "score 9.1 of 10"


class TestBuildRequest:
    def test_validates_the_destination(self, candidate):
        reference = {
            "id": "r1",
            "referee_name": "Jordan Referee",
            "referee_phone": "+1 (555) 555-0142",
            "relationship": "Former direct manager",
        }
        with pytest.raises(DestinationError):
            build_request(reference, candidate, TEMPLATES["standard"])

    def test_task_text_carries_no_phone_number(self, candidate):
        reference = {
            "id": "r1",
            "referee_name": "Jordan Referee",
            "referee_phone": GOOD,
            "relationship": "Former direct manager",
        }
        request = build_request(reference, candidate, TEMPLATES["standard"])
        assert GOOD not in request["task"]
        assert request["recipient"] == {"phones": [GOOD]}


class TestCredentialTargetPinning:
    def test_default_is_the_official_origin(self, monkeypatch):
        monkeypatch.delenv("CALLE_BASE_URL", raising=False)
        assert resolve_base_url() == DEFAULT_BASE_URL

    def test_official_origin_is_accepted(self):
        assert resolve_base_url("https://api.heycall-e.com") == "https://api.heycall-e.com"
        assert resolve_base_url("https://api.heycall-e.com/") == "https://api.heycall-e.com"

    def test_plaintext_http_is_refused(self):
        with pytest.raises(CredentialTargetError) as exc:
            resolve_base_url("http://api.heycall-e.com")
        assert "https" in str(exc.value)

    @pytest.mark.parametrize(
        "value",
        [
            "https://api.heycall-e.com.evil.example",   # suffix look-alike
            "https://evil.example",
            "https://api.heycall-e.com.attacker.test",
            "https://apiheycall-e.com",
            "https://api.heycall-e.com@evil.example",   # userinfo trick
        ],
    )
    def test_lookalike_hosts_are_refused(self, value):
        """startswith() would accept several of these; a URL parser must not."""
        with pytest.raises(CredentialTargetError):
            resolve_base_url(value)

    def test_embedded_credentials_are_refused(self):
        with pytest.raises(CredentialTargetError):
            resolve_base_url("https://user:pass@api.heycall-e.com")

    def test_path_or_query_is_refused(self):
        for value in (
            "https://api.heycall-e.com/v1",
            "https://api.heycall-e.com?x=1",
            "https://api.heycall-e.com#f",
        ):
            with pytest.raises(CredentialTargetError):
                resolve_base_url(value)

    def test_env_override_to_a_hostile_origin_is_refused(self, monkeypatch):
        monkeypatch.setenv("CALLE_BASE_URL", "https://evil.example")
        with pytest.raises(CredentialTargetError):
            resolve_base_url()
