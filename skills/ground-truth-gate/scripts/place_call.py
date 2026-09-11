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
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

import gate

BASE_URL_DEFAULT = "https://api.heycall-e.com"
BASE_URL_ENV_VAR = "CALLE_BASE_URL"
API_KEY_ENV_VAR = "CALLE_API_KEY"

CREATE_PATH = "/v1/calls"
GET_PATH = "/v1/calls/{call_id}"

# CallStatus values that mean the call is over, one way or another.
TERMINAL = frozenset({"completed", "failed", "canceled"})

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600


class TransportError(RuntimeError):
    """The request did not produce a usable answer."""


def resolve_base_url(explicit: str | None) -> str:
    return (explicit or os.environ.get(BASE_URL_ENV_VAR) or BASE_URL_DEFAULT).rstrip("/")


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
        with urllib.request.urlopen(request, timeout=30) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        # The key must never reach a log line, and an error body can echo the
        # request back, so the detail is truncated and never includes headers.
        detail = error.read().decode("utf-8", "replace")[:400]
        raise TransportError(f"HTTP {error.code} from {method} {url}: {detail}") from error
    except urllib.error.URLError as error:
        raise TransportError(f"could not reach {url}: {error.reason}") from error
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", metavar="CLAIM.JSON", help="the claim to gate")
    parser.add_argument("--claim-id", default="claim-demo")
    parser.add_argument("--webhook-url", help="https endpoint with an unguessable path segment")
    parser.add_argument("--base-url", help=f"default {BASE_URL_DEFAULT}, or ${BASE_URL_ENV_VAR}")
    parser.add_argument("--send", action="store_true", help="actually place the call")
    parser.add_argument(
        "--poll", action="store_true", help="wait for a terminal state, then reconcile"
    )
    parser.add_argument("--call-id", help="reconcile an existing call instead of placing one")
    parser.add_argument("--abstain", choices=("true", "false"))
    parser.add_argument("--reveal", action="store_true", help="print numbers unmasked")
    args = parser.parse_args(argv)

    base_url = resolve_base_url(args.base_url)
    abstain = {"true": True, "false": False}.get(args.abstain)

    # Reconcile-only: the call already happened, re-fetch and apply the rule.
    if args.call_id:
        try:
            call = get_call(base_url, require_api_key(), args.call_id)
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
        body = gate.build_request(claim, args.claim_id, args.webhook_url)
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

    try:
        created = create_call(base_url, require_api_key(), body, key)
    except TransportError as error:
        print(
            f"ERROR: {error}\n"
            "The call MAY ALREADY HAVE BEEN PLACED. Do not re-run blind: retry with the "
            f"same idempotency key, which cannot place a second call:\n  {key}",
            file=sys.stderr,
        )
        return 2

    call_id = created.get("id")
    print(f"\ncall created: id={call_id} status={created.get('status')}")
    if not args.poll:
        print(f"next: python3 scripts/place_call.py --call-id {call_id} --abstain false")
        return 0

    try:
        call = poll_until_terminal(base_url, require_api_key(), str(call_id))
    except TransportError as error:
        print(f"ERROR while polling: {error}", file=sys.stderr)
        return 2
    if call is None:
        print(
            f"\nNo terminal event within {POLL_TIMEOUT_SECONDS}s. The claim is UNRESOLVED, "
            "which is not the same as unconfirmed-and-settled. Surface it to the user as "
            "still unconfirmed rather than leaving them waiting for a correction."
        )
        return 0
    return summarize(call, abstain, args.reveal)


if __name__ == "__main__":
    raise SystemExit(main())
