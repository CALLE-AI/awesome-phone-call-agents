"""Where a credential is allowed to travel.

Both clients send a bearer token on every request. urllib follows redirects
and replays headers at the new host, so a single 302 is enough to hand an
Airtable token or a CALL-E key to somebody else. These tests pin that shut.
"""

from __future__ import annotations

import http.server
import threading
import unittest
import urllib.request

from certa.airtable import AirtableError, LiveAirtable
from certa.net import CredentialRoutingError, check_base_url, urlopen
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

    def test_loopback_may_be_plain_http_for_a_fake_server(self):
        check_base_url("http://127.0.0.1:8099", AIRTABLE, what="a token")

    def test_the_clients_refuse_a_plain_http_base_url(self):
        with self.assertRaises(AirtableError):
            LiveAirtable("pat_x", "app_x", base_url="http://api.airtable.com")
        with self.assertRaises(TransportError):
            LiveTransport("iams_x", base_url="http://api.heycall-e.com")


class _Redirector(http.server.BaseHTTPRequestHandler):
    """Answers every request with a redirect to another origin."""

    def do_GET(self):  # noqa: N802
        self.send_response(302)
        self.send_header("Location", "https://evil.test/collected")
        self.end_headers()

    def log_message(self, *a):  # noqa: D102 - keep the test output quiet
        pass


class RedirectsAreNotFollowed(unittest.TestCase):
    def setUp(self):
        self.server = http.server.HTTPServer(("127.0.0.1", 0), _Redirector)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v0/whatever"

    def test_a_redirect_is_reported_not_followed(self):
        request = urllib.request.Request(self.url)
        request.add_header("Authorization", "Bearer super-secret")
        with self.assertRaises(CredentialRoutingError) as caught:
            urlopen(request, timeout=5)
        message = str(caught.exception)
        self.assertIn("evil.test", message)
        self.assertNotIn("super-secret", message)

    def test_the_default_opener_would_have_followed_it(self):
        """Why this module exists. Not a test of our code: a demonstration
        that the behaviour being prevented is urllib's default."""
        request = urllib.request.Request(self.url)
        request.add_header("Authorization", "Bearer super-secret")
        try:
            urllib.request.urlopen(request, timeout=5)
        except Exception as exc:  # noqa: BLE001 - any failure is downstream of the redirect
            self.assertNotIsInstance(exc, CredentialRoutingError)


if __name__ == "__main__":
    unittest.main()
