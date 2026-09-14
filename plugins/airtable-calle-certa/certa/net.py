"""One place that decides where a credential may travel.

Both clients send a bearer token on every request, and both used
`urllib.request.urlopen`, which follows redirects and replays the request
headers at whatever host it lands on. A `302` from a compromised or merely
misconfigured endpoint is therefore enough to hand an Airtable personal
access token or a CALL-E API key to a third party, without the caller
seeing anything but a successful response.

So a credentialed request here does not redirect at all. If a host answers
with a redirect, that is reported rather than followed, and the operator
decides what to do about it. Airtable and CALL-E both answer their
documented endpoints directly; a redirect is a surprise worth surfacing.

The scheme is checked for the same reason. Pinning the host is not enough
on its own: `http://api.airtable.com` passes a hostname check and puts the
token on the wire in clear.
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request


class CredentialRoutingError(Exception):
    """A credential was about to travel somewhere it should not."""


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse every redirect on a credentialed request.

    urllib's default handler rebuilds the request for the new URL and, for a
    same-scheme redirect, carries the original headers with it. That is the
    leak this class exists to prevent, so it does not attempt to distinguish
    a same-host redirect from a cross-host one: a credentialed client that
    never redirects cannot leak by redirecting.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise CredentialRoutingError(
            f"A credentialed request answered with redirect status {code}. "
            "A credentialed request is not followed across a redirect, "
            "because the Authorization header would travel with it."
        )


_OPENER = urllib.request.build_opener(_RefuseRedirect)


def check_base_url(base_url: str, allowed: frozenset[str] | set[str], *, what: str) -> None:
    """Refuse a base URL that is not HTTPS, or not an allowed origin."""
    parts = urllib.parse.urlsplit(base_url)
    if parts.scheme != "https":
        raise CredentialRoutingError(
            f"refusing to send {what}; HTTPS is required."
        )
    origin = (parts.netloc or "").lower()
    if origin not in allowed:
        raise CredentialRoutingError(
            f"refusing to send {what} to an unapproved origin; credentialed requests are "
            f"restricted to {sorted(allowed)}."
        )


def urlopen(request: urllib.request.Request, *, timeout: float):
    """`urlopen` for a credentialed request: never follows a redirect."""
    return _OPENER.open(request, timeout=timeout)
