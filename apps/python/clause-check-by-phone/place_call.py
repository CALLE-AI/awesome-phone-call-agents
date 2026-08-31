# -*- coding: utf-8 -*-
"""Place the call that `bridge.py` prepared, against the CALL-E API.

    export CALLE_API_KEY=...
    export CALLE_ALLOWED_RECIPIENTS=+447700900123
    python place_call.py "students only" "Students only" --to +447700900123

This is the only file in the contribution that opens a socket. Everything that
can be settled without dialling is settled in `dry_run.py`, and this module
refuses to send anything that path would have rejected.

FOUR REFUSALS BEFORE ANYTHING RINGS, and they are the reason this file is
short. A clause outside the callable families never becomes a request. A
recipient the operator has not authorised is refused even when the number is
well formed, because a valid number is not the same thing as a number you are
allowed to call. A schema the provider cannot fill is refused here rather than
after the call, because the provider accepts it at creation and only fails at
extraction, once the call, the budget and a stranger's minute are already
spent. And a missing key stops the run with a sentence rather than with a 401
that reads like a permissions problem.

The network call goes through `send`, which is a parameter. That is not
ceremony, it is what lets the witnesses exercise this file without a key and
without dialling anyone.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.error
import urllib.request

from bridge import call_task, contradiction, NothingToAsk, validate_result_schema

CALLS = "https://api.heycall-e.com/v1/calls"
ALLOWED = "CALLE_ALLOWED_RECIPIENTS"


class Refused(Exception):
    """Raised before any request leaves the machine."""


def authorised(phone: str) -> bool:
    """True when the operator has listed this number as callable.

    The list is read from CALLE_ALLOWED_RECIPIENTS, comma separated, in the
    same international form the bridge validates. An absent or empty list
    authorises nothing. That is the right default for the one file here that
    can make a stranger's phone ring, and it means a wrong number in a shell
    history cannot dial on its own.
    """
    listed = os.environ.get(ALLOWED, "")
    return phone in [n.strip() for n in listed.split(",") if n.strip()]


def _http(url: str, key: str, body: bytes | None = None, timeout: int = 45):
    request = urllib.request.Request(
        url, data=body, method="POST" if body else "GET",
        headers={"Authorization": "Bearer %s" % key,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as refusal:
        raw = refusal.read().decode("utf-8", "replace")
        try:
            return refusal.code, json.loads(raw)
        except ValueError:
            return refusal.code, {"raw": raw[:400]}


def place(phone: str, family: str, quote: str, source: str,
          context: dict | None = None, key: str | None = None, send=_http):
    """Prepare, check, then dial. Returns the provider's response.

    Raises `Refused` when the call should not be placed, and `NothingToAsk`
    when the clause does not justify one. The two are different failures and
    the caller usually wants to treat them differently, a refusal is a bug in
    the request and a NothingToAsk is the ordinary outcome on a clean page.
    """
    key = key or os.environ.get("CALLE_API_KEY")
    if not key:
        raise Refused("no CALLE_API_KEY in the environment, nothing was sent")

    prepared = call_task(phone, family, quote, source, context)

    if not authorised(phone):
        raise Refused("%s is not listed in %s, no call was placed. A recipient "
                      "has to be authorised by the operator before it can be "
                      "dialled." % (phone, ALLOWED))

    problems = validate_result_schema(prepared["result_schema"])
    if problems:
        raise Refused("the provider would accept this schema and then fail to "
                      "fill it, %s" % "; ".join(problems))

    body = json.dumps({"task": prepared["task"],
                       "result_schema": prepared["result_schema"]}).encode("utf-8")
    status, payload = send(CALLS, key, body)
    if status >= 300:
        raise Refused("the provider refused the call, %s %s" % (status, payload))
    return prepared, payload


def collect(call_id: str, prepared: dict | None = None,
            key: str | None = None, send=_http):
    """Read a finished call back.

    With `prepared`, also returns what the page and the voice disagree on, or
    None when they do not, which is the whole output of this project. Without
    it, returns the provider payload alone.
    """
    key = key or os.environ.get("CALLE_API_KEY")
    if not key:
        raise Refused("no CALLE_API_KEY in the environment")
    status, payload = send("%s/%s" % (CALLS, call_id), key, None)
    if status >= 300:
        raise Refused("could not read the call, %s %s" % (status, payload))
    if prepared is None:
        return payload
    return payload, contradiction(prepared, payload.get("structured_result") or {})


def main(argv=None):
    argv = list(argv if argv is not None else sys.argv[1:])
    if "--to" not in argv or len(argv) < 4:
        print(__doc__.strip())
        return 2
    at = argv.index("--to")
    phone = argv[at + 1]
    argv = argv[:at] + argv[at + 2:]

    context = {}
    if "--country" in argv:
        at = argv.index("--country")
        context["country"] = argv[at + 1]
        argv = argv[:at] + argv[at + 2:]

    family, quote = argv[0], " ".join(argv[1:])
    print("This dials a real person. The recipient must be listed in %s."
          % ALLOWED)
    try:
        prepared, payload = place(phone, family, quote, "place_call", context)
    except NothingToAsk as settled:
        print("NO CALL JUSTIFIED, %s" % settled)
        return 1
    except Refused as refusal:
        print("REFUSED BEFORE DIALLING, %s" % refusal)
        return 1

    print("queued, call id %s, status %s"
          % (payload.get("id", "?"), payload.get("status", "?")))
    print("the page said, %s" % prepared["quote"])
    print("read it back later with")
    print("  python -c \"import place_call as p, json;"
          " print(json.dumps(p.collect('%s'), indent=2))\"" % payload.get("id", "..."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
