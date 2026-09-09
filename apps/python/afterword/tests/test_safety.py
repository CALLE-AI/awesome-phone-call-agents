"""The two things a reviewer asked us to guarantee.

An API key must never leave for an unapproved origin, and nothing that reaches
a terminal or an HTTP response may carry a dialable number.
"""

from __future__ import annotations

import pytest

from afterword import calle
from afterword.api import capture_payload
from afterword.safety import redact, redact_all


class TestCredentialsStayOnTheApprovedOrigin:
    def test_the_default_origin_is_accepted(self) -> None:
        assert calle.HttpClient(api_key="k").base_url == calle.BASE_URL

    @pytest.mark.parametrize(
        "base_url",
        [
            "http://api.heycall-e.com/v1",          # plaintext
            "https://evil.example.com/v1",          # another host
            "https://api.heycall-e.com.evil.net/v1",  # lookalike suffix
            "https://user:pw@evil.example.com/v1",  # credentials in the URL
            "//evil.example.com/v1",                # scheme-relative
        ],
    )
    def test_an_unapproved_origin_is_refused(self, base_url: str) -> None:
        """The override exists for a staging host, not as a way to post a bearer
        token to an arbitrary server."""
        with pytest.raises(calle.CalleError) as caught:
            calle.HttpClient(api_key="k", base_url=base_url)
        assert caught.value.code == "forbidden"

    def test_a_redirect_is_refused_rather_than_followed(self) -> None:
        """urllib re-sends the Authorization header across hosts, so one 302
        would hand the key to whoever it points at."""
        handler = calle._RefuseRedirects()
        with pytest.raises(calle.CalleError) as caught:
            handler.redirect_request(None, None, 302, "Found", {}, "https://evil.example.com/")
        assert caught.value.code == "forbidden"

    def test_the_refusal_does_not_echo_the_key(self) -> None:
        with pytest.raises(calle.CalleError) as caught:
            calle.HttpClient(api_key="iams_live_secret", base_url="https://evil.example.com")
        assert "iams_live_secret" not in str(caught.value)


class TestNothingDialableLeaves:
    @pytest.mark.parametrize(
        "text",
        [
            "call to +12025550143 failed",
            "ring me on 202 555 0144",
            "the number is (202) 555-0142",
            "+1-202-555-0145 is unreachable",
        ],
    )
    def test_a_number_is_masked(self, text: str) -> None:
        out = redact(text)
        digits = "".join(c for c in text if c.isdigit())
        assert digits not in "".join(out.split())
        assert "*" in out

    @pytest.mark.parametrize("text", ["reference PEN-1041", "NBS-88213", "order 12345", "9 September 2026"])
    def test_short_identifiers_survive(self, text: str) -> None:
        """Redaction that eats references would make the pack useless."""
        assert redact(text) == text

    def test_redact_all_handles_a_sequence(self) -> None:
        assert redact_all(["+12025550143", "fine"])[1] == "fine"

    def test_the_api_payload_carries_no_dialable_number(self) -> None:
        payload = capture_payload("inst-01", None)
        blob = " ".join(
            [payload["task_text"], *payload["evidence_quotes"]]
            + [turn["text"] for turn in payload["transcript"]]
        )
        assert payload["masked_phone"].count("*") >= 6
        import re
        for run in re.findall(r"\d[\d\s().-]{5,}\d", blob):
            assert len(re.sub(r"\D", "", run)) < 7, run
