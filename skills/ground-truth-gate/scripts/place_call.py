#!/usr/bin/env python3
"""Place the gated call, then reconcile the result CALL-E returns.

`gate.py` decides whether a call is warranted and builds the request body. This
file is the only thing in the skill that opens a socket, and it does three
things and no more:

  1. send:      POST /v1/calls with the body gate.build_request() produced
  2. poll:      GET  /v1/calls/{id} until the call reaches a terminal state
  3. reconcile: apply gate.release() to the re-fetched result, never to a
                webhook body

Step 3 is why polling exists here at all. A webhook delivery is unsigned, so it
is a notification that something happened, never evidence of what happened. The
authoritative record is whatever GET returns, and that is what gets released.

Standard library only, on purpose: the skill installs standalone into a repo
that may have no dependency manifest, and a judge should be able to run it with
nothing but Python.

Dry run is still the default. Nothing dials without --send.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

import gate

BASE_URL_DEFAULT = "https://api.heycall-e.com"
BASE_URL_ENV_VAR = "CALLE_BASE_URL"
ALLOWED_ORIGINS_ENV_VAR = "CALLE_ALLOWED_ORIGINS"
API_KEY_ENV_VAR = "CALLE_API_KEY"

CREATE_PATH = "/v1/calls"
GET_PATH = "/v1/calls/{call_id}"

# CallStatus values that mean the call is over, one way or another.
TERMINAL = frozenset({"completed", "failed", "canceled"})

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600


class TransportError(RuntimeError):
    """The request did not produce a usable answer.

    reached_server records whether any bytes actually got to the provider,
    because that decides which warning the operator sees. A DNS failure or a
    refused connection proves no call was placed. Anything that did reach the
    provider - an HTTP error, a refused redirect (the 302 means the POST
    arrived), a read timeout - leaves it genuinely unknown, and those keep the
    louder "may already have dialed" warning. Telling an operator a call might
    be out when it provably is not trains them to ignore the warning that
    matters.
    """

    def __init__(self, *args: object, reached_server: bool = True) -> None:
        super().__init__(*args)
        self.reached_server = reached_server


def _is_loopback_host(hostname: str) -> bool:
    """Is this host loopback, so a plain http:// rehearsal is allowed?

    Reuses gate's `_embedded_v4` (the NAT64/6to4/Teredo/v4-mapped unwrap) rather
    than re-deriving that handling here, per the instruction not to write a
    second, weaker parser. Deliberately narrower than gate._host_is_public's
    hostname branch, though: it recognizes only the literal forms an operator
    would type (127.0.0.1, ::1, localhost), not octal/hex/short-form spellings
    like `127.1`. Under-recognizing loopback only forces https, which is the
    safe direction here; the risk this whole allowlist exists to close is
    something being MISTAKEN for loopback and let through as http.
    """
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return hostname == "localhost"
    return gate._embedded_v4(address).is_loopback


def _default_allowed_hosts() -> set[str]:
    """The host in BASE_URL_DEFAULT, plus loopback. Always allowed, unconditionally.

    Loopback must stay in the default set no matter what CALLE_ALLOWED_ORIGINS
    says: mock_calle.py binds 127.0.0.1, and `--base-url http://127.0.0.1:PORT`
    is the documented free-rehearsal path. Breaking it breaks the skill.
    """
    return {urlsplit(BASE_URL_DEFAULT).hostname or "", "127.0.0.1", "::1", "localhost"}


def _operator_allowed_hosts() -> set[str]:
    """Additional hosts an operator has explicitly approved, via env.

    Each entry may be a bare host or a full origin (scheme://host[:port]); only
    the host is compared, since the scheme constraint (https, except loopback)
    is enforced separately and unconditionally in resolve_base_url.
    """
    hosts = set()
    for origin in os.environ.get(ALLOWED_ORIGINS_ENV_VAR, "").split(","):
        origin = origin.strip()
        if not origin:
            continue
        parsed = urlsplit(origin if "//" in origin else f"//{origin}")
        hosts.add((parsed.hostname or origin).lower())
    return hosts


def resolve_base_url(explicit: str | None) -> str:
    """Resolve the provider base URL and refuse anything off the allowlist.

    Two independent checks, both required (PR #454): the scheme must be https,
    except for loopback where http is required for mock_calle.py rehearsal;
    and the host must be on an operator-approved allowlist, because https alone
    does not stop the Bearer credential from being sent to an arbitrary,
    correctly-TLS'd host the operator never approved.
    """
    raw = (explicit or os.environ.get(BASE_URL_ENV_VAR) or BASE_URL_DEFAULT).rstrip("/")
    parts = urlsplit(raw)
    hostname = (parts.hostname or "").lower()
    if not hostname:
        raise TransportError(f"--base-url {raw!r} has no host")

    if parts.scheme == "https":
        pass
    elif parts.scheme == "http" and _is_loopback_host(hostname):
        pass  # mock_calle.py rehearsal path; loopback traffic never leaves the box
    else:
        raise TransportError(
            f"--base-url {raw!r} uses scheme {parts.scheme!r}, which is refused. "
            "Only https:// is permitted for a non-loopback host; http:// is allowed "
            "only for 127.0.0.1 / ::1 / localhost, to rehearse against mock_calle.py."
        )

    allowed = _default_allowed_hosts() | _operator_allowed_hosts()
    if hostname not in allowed:
        raise TransportError(
            f"--base-url host {hostname!r} is not on the operator allowlist "
            f"({', '.join(sorted(h for h in allowed if h))}). To permit another "
            f"provider origin, set {ALLOWED_ORIGINS_ENV_VAR}=https://your-provider.example "
            "(comma-separated for more than one)."
        )
    return raw


def require_api_key() -> str:
    key = os.environ.get(API_KEY_ENV_VAR, "").strip()
    if not key:
        raise TransportError(
            f"set {API_KEY_ENV_VAR} to place a live call. "
            "Run scripts/mock_calle.py and pass --base-url to exercise the whole "
            "loop without a credential."
        )
    return key


def idempotency_key(body: dict[str, Any], claim_id: str) -> str:
    """Derive the key from the call itself, so a retry cannot dial twice.

    A random key per invocation is the dangerous default for a tool that dials
    real phone numbers: if the create request times out, the operator does not
    know whether the call was placed, and the obvious recovery (run it again)
    generates a NEW key and rings a stranger a second time. Deriving it from
    the request body means the retry IS the same request.
    """
    canonical = json.dumps(
        {"claim_id": claim_id, "body": body}, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return f"ground-truth-gate:{hashlib.sha256(canonical).hexdigest()[:32]}"


class _CredentialRedirectRefused(Exception):
    """Raised in place of following a redirect on a request that carries a Bearer token.

    Deliberately NOT a urllib.error.URLError subclass: URLError's __str__
    wraps the message as "<urlopen error ...>", and this is caught by its
    exact type below (before the generic URLError handler runs), so nothing
    needs it to be part of that hierarchy. A plain Exception keeps the
    TransportError message that wraps it readable.
    """


class _NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse to follow a redirect while the request carries credentials.

    The default opener's HTTPRedirectHandler rebuilds the request for the new
    location and resends it with the SAME headers, Authorization included. A
    provider origin (or anything on-path to it) that answers with a 302 to a
    different, attacker-controlled host would otherwise get the Bearer token
    handed to it for free. Every request this script makes carries a token
    (see request_json), so this refuses every redirect rather than trying to
    reason about which ones are same-origin-safe.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        if req.has_header("Authorization"):
            raise _CredentialRedirectRefused(
                f"refused to follow {code} redirect to {newurl!r}: the request carries "
                "credentials, and this skill never resends those cross-request"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# Built once: an opener whose only difference from urllib's default is refusing
# credential-carrying redirects. Reused for every request_json() call.
_OPENER = urllib.request.build_opener(_NoCredentialRedirect)

_BEARER_RE = re.compile(r"Bearer\s+\S+", re.IGNORECASE)


def _sanitize_error_body(text: str, api_key: str) -> str:
    """Strip what safety.md promises never appears in a line the operator sees.

    Truncating the body (the old `[:400]`) is not content filtering: a provider
    that echoes the request back on error put the key and the recipient's
    number on the stderr line this raises to, just below the 400-char cutoff.
    gate.mask / gate.mask_text already do the phone masking this skill relies
    on everywhere else, so they are reused rather than re-implemented, and
    safe_print strips control characters that could hide something in a
    truncated span.
    """
    scrubbed = text.replace(api_key, "[REDACTED]") if api_key else text
    scrubbed = _BEARER_RE.sub("Bearer [REDACTED]", scrubbed)
    return gate.mask_text(gate.safe_print(scrubbed))


def request_json(
    method: str,
    url: str,
    api_key: str,
    body: dict[str, Any] | None = None,
    **headers: str,
) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=payload, method=method)
    request.add_header("Authorization", f"Bearer {api_key}")
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    for name, value in headers.items():
        request.add_header(name.replace("_", "-"), value)
    try:
        with _OPENER.open(request, timeout=30) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except _CredentialRedirectRefused as error:
        raise TransportError(str(error)) from error
    except urllib.error.HTTPError as error:
        # The key must never reach a log line, and an error body can echo the
        # request back, so it is content-filtered, not just truncated.
        raw = error.read().decode("utf-8", "replace")[:400]
        detail = _sanitize_error_body(raw, api_key)
        raise TransportError(f"HTTP {error.code} from {method} {url}: {detail}") from error
    except urllib.error.URLError as error:
        # A read timeout can fire after the POST is already on the wire, so it
        # stays ambiguous. A DNS or connect failure never delivered a byte.
        reached = isinstance(error.reason, TimeoutError)
        raise TransportError(
            f"could not reach {url}: {error.reason}", reached_server=reached
        ) from error
    except json.JSONDecodeError as error:
        raise TransportError(f"{method} {url} returned a non-JSON body") from error
    if not isinstance(decoded, dict):
        raise TransportError(
            f"{method} {url} returned {type(decoded).__name__}, expected an object"
        )
    return decoded


def create_call(base_url: str, api_key: str, body: dict[str, Any], key: str) -> dict[str, Any]:
    return request_json("POST", f"{base_url}{CREATE_PATH}", api_key, body, Idempotency_Key=key)


def get_call(base_url: str, api_key: str, call_id: str) -> dict[str, Any]:
    return request_json("GET", f"{base_url}{GET_PATH.format(call_id=call_id)}", api_key)


def poll_until_terminal(
    base_url: str,
    api_key: str,
    call_id: str,
    *,
    interval: int = POLL_INTERVAL_SECONDS,
    timeout: int = POLL_TIMEOUT_SECONDS,
    sleep=time.sleep,
    now=time.monotonic,
) -> dict[str, Any] | None:
    """Poll until the call is terminal. None means the deadline passed first.

    None is not a failure to report as an error: it is the unresolved-claim
    outcome, and it is the one this skill treats as most dangerous, because
    silence looks exactly like a pending correction.
    """
    deadline = now() + timeout
    while True:
        call = get_call(base_url, api_key, call_id)
        status = call.get("status")
        print(f"  status: {status}")
        if status in TERMINAL:
            return call
        if now() >= deadline:
            return None
        sleep(interval)


def summarize(call: dict[str, Any], abstain: bool | None, reveal: bool) -> int:
    """Apply the release rule to a re-fetched call and say what happens next."""
    show = (
        (lambda text: gate.safe_print(text))
        if reveal
        else (lambda text: gate.mask_text(gate.safe_print(text)))
    )
    result = call.get("structured_result") or {}
    if not isinstance(result, dict):
        result = {}
    verdict = result.get("verdict", "unknown")
    if verdict not in gate.VERDICTS:
        verdict = "unknown"

    # An object with score and label, and null until the terminal post-summary
    # outcome exists, so a handler that reads it eagerly gets null, not a score.
    confidence = call.get("completion_confidence")
    label = confidence.get("label") if isinstance(confidence, dict) else None

    released = gate.release(verdict, abstain)
    print(f"\ncall:     {call.get('id')}  status={call.get('status')}")
    print(f"verdict:  {verdict}" + (f"  (completion confidence: {label})" if label else ""))
    print(f"abstain:  {abstain if abstain is not None else 'not supplied'}")
    print(f"released: {released}")

    if released:
        quoted = show(str(result.get("quoted_answer", "")))
        print(f"\nWrite the correction back, quoting: {quoted!r}")
        if result.get("valid_until_note"):
            print(f"Expiry the person stated: {show(str(result['valid_until_note']))}")
        return 0
    print("\nThe provisional answer stands unchanged. Tell the user it is still unconfirmed.")
    if abstain is None:
        print(
            "No abstention decision was supplied, so nothing is released. "
            "See references/composition.md for the verify-by-phone handoff."
        )
    return 0


def _dns_resolver(hostname: str) -> list[str]:
    """The resolver gate.require_public_https() needs to catch DNS rebinding.

    Wired in only right before a webhook_url is actually used to place a call
    (see main(), `resolver=_dns_resolver if args.send else None`): resolving a
    hostname opens a socket, and gate.py's own docstring is explicit that
    nothing in that module does. A dry run must not either.
    """
    infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    # sockaddr is (host, port) for AF_INET or (host, port, flowinfo, scopeid)
    # for AF_INET6; element 0 is the address in both, typed as str | Any by
    # typeshed, hence the explicit str() rather than trusting inference.
    return [str(info[4][0]) for info in infos]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--input", metavar="CLAIM.JSON", help="the claim to gate")
    mode.add_argument("--call-id", help="reconcile an existing call instead of placing one")
    parser.add_argument("--claim-id", default="claim-demo")
    parser.add_argument("--webhook-url", help="https endpoint with an unguessable path segment")
    parser.add_argument("--base-url", help=f"default {BASE_URL_DEFAULT}, or ${BASE_URL_ENV_VAR}")
    parser.add_argument("--send", action="store_true", help="actually place the call")
    parser.add_argument(
        "--poll", action="store_true", help="wait for a terminal state, then reconcile"
    )
    parser.add_argument("--abstain", choices=("true", "false"))
    parser.add_argument("--reveal", action="store_true", help="print numbers unmasked")
    args = parser.parse_args(argv)

    try:
        base_url = resolve_base_url(args.base_url)
    except TransportError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    abstain = {"true": True, "false": False}.get(args.abstain)

    # Reconcile-only: the call already happened, re-fetch and apply the rule.
    if args.call_id:
        try:
            api_key = require_api_key()
        except TransportError as error:
            print(f"ERROR: {error}", file=sys.stderr)
            return 2
        try:
            call = get_call(base_url, api_key, args.call_id)
        except TransportError as error:
            print(f"ERROR: {error}", file=sys.stderr)
            return 2
        return summarize(call, abstain, args.reveal)

    if not args.input:
        parser.error("--input is required unless --call-id is given")
    try:
        with open(args.input, encoding="utf-8") as handle:
            claim = gate.claim_from_dict(json.load(handle))
        action, reason = gate.decide(claim)
        if action != "gate":
            # Not an error. Most claims should end here, and that is the point.
            print(f"decision: {action} - {reason}")
            print("No call is warranted. Nothing was sent.")
            return 0
        # The DNS resolver is a real socket op, so it is withheld on a dry run
        # and supplied only when this invocation is actually about to place
        # the call - see references/safety.md and _dns_resolver's docstring.
        body = gate.build_request(
            claim,
            args.claim_id,
            args.webhook_url,
            resolver=_dns_resolver if args.send else None,
        )
    except (gate.ClaimError, OSError, json.JSONDecodeError) as error:
        print(f"cannot build the call: {error}", file=sys.stderr)
        return 2

    key = idempotency_key(body, args.claim_id)
    # Printed BEFORE the request. If create times out, the operator still has
    # the key and can retry without risking a second dial.
    print(f"idempotency key: {key}")
    print(f"party:    {gate.mask(claim.authority_phone or '')}")
    print(f"question: {gate.mask_text(claim.question)}")

    if not args.send:
        print(f"\nDRY RUN. POST {base_url}{CREATE_PATH}")
        print(json.dumps(body if args.reveal else gate.redact(body), indent=2))
        print("\nRe-run with --send to place the call.")
        return 0

    # Hoisted out of the try below and given its own error path: a missing key
    # never opens a socket, so it must never be reported as "may have dialed".
    try:
        api_key = require_api_key()
    except TransportError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    try:
        created = create_call(base_url, api_key, body, key)
    except TransportError as error:
        if error.reached_server:
            print(
                f"ERROR: {error}\n"
                "The call MAY ALREADY HAVE BEEN PLACED. Do not re-run blind: retry with "
                f"the same idempotency key, which cannot place a second call:\n  {key}",
                file=sys.stderr,
            )
        else:
            print(
                f"ERROR: {error}\n"
                "No connection was established, so no call was placed. Fix the "
                "connection and re-run.",
                file=sys.stderr,
            )
        return 2

    call_id = created.get("id")
    print(f"\ncall created: id={call_id} status={created.get('status')}")
    if not args.poll:
        print(f"next: python3 scripts/place_call.py --call-id {call_id} --abstain false")
        return 0

    try:
        terminal_call = poll_until_terminal(base_url, api_key, str(call_id))
    except TransportError as error:
        print(f"ERROR while polling: {error}", file=sys.stderr)
        return 2
    if terminal_call is None:
        print(
            f"\nNo terminal event within {POLL_TIMEOUT_SECONDS}s. The claim is UNRESOLVED, "
            "which is not the same as unconfirmed-and-settled. Surface it to the user as "
            "still unconfirmed rather than leaving them waiting for a correction."
        )
        return 0
    return summarize(terminal_call, abstain, args.reveal)


if __name__ == "__main__":
    raise SystemExit(main())
