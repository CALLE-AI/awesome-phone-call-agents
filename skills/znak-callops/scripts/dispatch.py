#!/usr/bin/env python3
"""Optional CALL-E SDK adapter. Defaults to a no-network, no-call preview.

Contract: https://docs.heycall-e.com/sdks (calle-ai==0.7.0).
Live dispatch can cost credits and place a real phone call. It cannot be recalled
through this adapter. A saved receipt blocks re-dispatch, including after errors.
"""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from callops import InputError, prepare_goal, read_json


ORIGIN = "https://api.heycall-e.com"
E164 = re.compile(r"\+[1-9][0-9]{7,14}\Z")
CALL_ID = re.compile(r"[A-Za-z0-9_-]{1,200}\Z")


def masked(phone):
    return "NOT_PROVIDED" if phone is None else "+***" + phone[-2:]


@contextmanager
def official_client(api_key):
    # Imported only after explicit live/read opt-in. No configurable API origin.
    try:
        import httpx
        from calle import CalleClient
    except ImportError as exc:
        raise InputError("Live adapter requires Python 3.11+ and calle-ai==0.7.0") from exc
    with httpx.Client(
        base_url=ORIGIN,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30.0,
        follow_redirects=False,
        trust_env=False,
        transport=httpx.HTTPTransport(retries=0),
    ) as transport:
        with CalleClient(api_key=api_key, base_url=ORIGIN, http_client=transport) as client:
            yield client


def api_key_from_environment():
    key = os.environ.get("CALLE_API_KEY", "").strip()
    if not key:
        raise InputError("CALLE_API_KEY is required for live dispatch or status reads")
    return key


def write_receipt(handle, record):
    handle.seek(0)
    json.dump(record, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())


def dispatch(request, *, phone=None, region=None, locale=None, live=False,
             recipient_consent=False, receipt_path=None, client_factory=official_client):
    goal = prepare_goal(request)
    if phone is not None and (not isinstance(phone, str) or not E164.fullmatch(phone)):
        raise InputError("Destination must be one valid E.164 number")
    if (region is not None and (not isinstance(region, str) or not re.fullmatch(r"[A-Z]{2}", region))) or (locale is not None and (not isinstance(locale, str) or not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}", locale))):
        raise InputError("Use an uppercase country code and locale such as PL / pl-PL")
    payload = {
        "task": goal["goal"],
        "recipients": [{"phones": [phone], "region": region, "locale": locale}],
        "metadata": {"workflow_run_id": goal["task_id"]},
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    summary = {
        "mode": "PREVIEW_NO_NETWORK",
        "destination": masked(phone),
        "allowed_effect": goal["allowed_effect"],
        "request_sha256": digest,
        "limitations": "One create request only. No automatic retry, recurrence, or cancellation. This output proves no call outcome.",
    }
    if not live:
        return summary
    if phone is None or region is None or locale is None or not recipient_consent or not receipt_path:
        raise InputError("Live dispatch needs --phone, --region, --locale, --recipient-consent and --receipt")
    api_key = api_key_from_environment()
    receipt_path = Path(receipt_path)
    # Atomic exclusive creation also prevents two concurrent processes using this
    # receipt from dialing twice. Keep this file after success AND ambiguity.
    try:
        descriptor = os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise InputError("Receipt already exists. Read its status; do not redispatch or delete it to retry") from exc
    record = {
        "adapter": "znak-callops-calle-sdk-0.7.0",
        "state": "DISPATCH_INTENT_RECORDED",
        "destination": masked(phone),
        "request_sha256": digest,
        "idempotency_key": "znak-callops-" + digest,
        "call_id": None,
    }
    with os.fdopen(descriptor, "w", encoding="utf-8") as receipt:
        write_receipt(receipt, record)
        try:
            with client_factory(api_key) as client:
                record["state"] = "DISPATCH_ATTEMPTED"
                write_receipt(receipt, record)
                response = client.calls.create(**payload, idempotency_key=record["idempotency_key"])
                record["provider_response"] = response
                call_id = response.get("id") if isinstance(response, dict) else None
                if isinstance(call_id, str) and CALL_ID.fullmatch(call_id):
                    record["call_id"] = call_id
                    record["state"] = "ACCEPTED_FOR_PROCESSING"
                else:
                    record["state"] = "AMBIGUOUS_NO_CALL_ID"
                write_receipt(receipt, record)
        except Exception:
            # Do not echo provider exceptions: they may contain private payloads.
            # Some errors occur before dispatch, others after; never guess/retry.
            record["state"] = "AMBIGUOUS_STOP_NO_RETRY"
            write_receipt(receipt, record)
    summary["mode"] = "LIVE_DISPATCH_ATTEMPT"
    summary["state"] = record["state"]
    summary["call_id"] = record["call_id"]
    summary["next_step"] = "Keep the private receipt. Read status by saved ID; if ID is absent, inspect the provider dashboard before any new attempt."
    return summary


def read_status(receipt_path, *, client_factory=official_client):
    record = read_json(receipt_path)
    call_id = record.get("call_id") if isinstance(record, dict) else None
    if not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id):
        raise InputError("Receipt has no valid call ID. Inspect provider dashboard; do not redispatch")
    with client_factory(api_key_from_environment()) as client:
        response = client.calls.get(call_id)
    if not isinstance(response, dict):
        raise InputError("Provider returned no status object; keep receipt and resume reads later")
    status = response.get("status")
    # Retain full response privately for transcript handoff. Do not print raw
    # provider summaries, recipient numbers or transcripts into shared logs.
    with open(receipt_path, "r+", encoding="utf-8") as receipt:
        record["latest_provider_response"] = response
        write_receipt(receipt, record)
    return {
        "mode": "READ_ONLY_STATUS",
        "call_id": call_id,
        "provider_status": status if status in ("queued", "in_progress", "completed", "failed", "canceled") else "UNKNOWN_STATUS_REVIEW_PRIVATE_RECEIPT",
        "field_evidence": "UNKNOWN until original transcript turns are normalized and reviewed",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--request", help="Local service/window request JSON; preview unless --live")
    action.add_argument("--read-receipt", help="Read status once using a saved call ID; never dispatch")
    parser.add_argument("--phone", help="One destination E.164 number; never a default live recipient")
    parser.add_argument("--region", help="Explicit supported destination country, e.g. PL")
    parser.add_argument("--locale", help="Explicit language and locale, e.g. pl-PL")
    parser.add_argument("--live", action="store_true", help="Explicitly authorize one real, potentially chargeable call")
    parser.add_argument("--recipient-consent", action="store_true", help="Attest this recipient authorized this inquiry")
    parser.add_argument("--receipt", help="New private receipt file outside this repository; existing files block dispatch")
    args = parser.parse_args(argv)
    try:
        if args.read_receipt:
            if args.live:
                raise InputError("--read-receipt cannot be combined with --live")
            output = read_status(args.read_receipt)
        else:
            output = dispatch(read_json(args.request), phone=args.phone, region=args.region,
                              locale=args.locale, live=args.live, recipient_consent=args.recipient_consent,
                              receipt_path=args.receipt)
        print(json.dumps(output, indent=2))
        return 1 if output.get("state", "").startswith("AMBIGUOUS") else 0
    except (InputError, OSError):
        print(json.dumps({"error": "BLOCKED", "message": "Check arguments, SDK installation, CALLE_API_KEY and private receipt. No automatic retry was attempted."}), file=sys.stderr)
        return 2
    except Exception:
        print(json.dumps({"error": "PROVIDER_READ_FAILED", "message": "Keep the receipt and resume reads later; do not redispatch."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
