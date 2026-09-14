"""Where a credential is allowed to travel.

Both clients send a bearer token on every request. urllib follows redirects
and replays headers at the new host, so a single 302 is enough to hand an
Airtable token or a CALL-E key to somebody else. These tests pin that shut.
"""

from __future__ import annotations

import unittest
import urllib.request

from certa.airtable import AirtableError, LiveAirtable
from certa.net import CredentialRoutingError, _RefuseRedirect, check_base_url
from certa.transport import LiveTransport, TransportError

AIRTABLE = frozenset({"api.airtable.com"})


class SchemeAndOrigin(unittest.TestCase):
    def test_https_is_required(self):
        """Pinning the host is not enough: http://api.airtable.com passes a
        hostname check and puts the token on the wire in clear."""
        with self.assertRaises(CredentialRoutingError) as caught:
            check_base_url("http://api.airtable.com", AIRTABLE, what="a token")
        self.assertIn("HTTPS is required", str(caught.exception))

    def test_a_lookalike_host_is_refused(self):
        for host in ("api.airtable.com.evil.test", "evil.test", "airtable.com"):
            with self.assertRaises(CredentialRoutingError, msg=host):
                check_base_url(f"https://{host}", AIRTABLE, what="a token")

    def test_https_to_the_real_origin_is_allowed(self):
        check_base_url("https://api.airtable.com", AIRTABLE, what="a token")

    def test_live_clients_cannot_send_tokens_to_loopback(self):
        for base in ("http://127.0.0.1:8099", "http://localhost:8099", "https://localhost"):
            with self.subTest(base=base):
                with self.assertRaises(AirtableError):
                    LiveAirtable("pat_example", "app_example", base_url=base)
                with self.assertRaises(TransportError):
                    LiveTransport("iams_example", base_url=base)

    def test_rejected_urls_are_not_repeated_in_errors(self):
        for base in ("http://api.airtable.com?token=fake-secret", "https://fake-secret@evil.test"):
            with self.assertRaises(CredentialRoutingError) as caught:
                check_base_url(base, AIRTABLE, what="a token")
            self.assertNotIn("fake-secret", str(caught.exception))

    def test_the_clients_refuse_a_plain_http_base_url(self):
        with self.assertRaises(AirtableError):
            LiveAirtable("pat_x", "app_x", base_url="http://api.airtable.com")
        with self.assertRaises(TransportError):
            LiveTransport("iams_x", base_url="http://api.heycall-e.com")


class RedirectsAreNotFollowed(unittest.TestCase):
    def test_a_redirect_is_reported_not_followed(self):
        request = urllib.request.Request("https://api.airtable.com/v0/example?token=fake-source-secret")
        request.add_header("Authorization", "Bearer fake-secret")
        location = "https://evil.test/collected?phone=+12025550100&token=fake-target-secret"
        with self.assertRaises(CredentialRoutingError) as caught:
            _RefuseRedirect().redirect_request(request, None, 302, "Found", {}, location)
        message = str(caught.exception)
        self.assertIn("302", message)
        for hidden in ("evil.test", "+12025550100", "fake-source-secret", "fake-target-secret", "fake-secret"):
            self.assertNotIn(hidden, message)

    def test_the_default_opener_would_have_followed_it(self):
        """Why this module exists. Not a test of our code: a demonstration
        that the behaviour being prevented is urllib's default."""
        request = urllib.request.Request("https://api.airtable.com/v0/example")
        request.add_header("Authorization", "Bearer fake-secret")
        redirected = urllib.request.HTTPRedirectHandler().redirect_request(
            request, None, 302, "Found", {}, "https://evil.test/collected"
        )
        # Inspect the reconstructed request only; never execute either request.
        self.assertEqual(redirected.get_header("Authorization"), "Bearer fake-secret")


if __name__ == "__main__":
    unittest.main()
