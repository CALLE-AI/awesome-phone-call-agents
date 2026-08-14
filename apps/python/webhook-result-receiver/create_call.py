"""Preview or explicitly create one CALL-E human-follow-up call."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import sys
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import urlparse


E164 = re.compile(r"^\+[1-9]\d{7,14}$")
WORKFLOW_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
TASK = (
    "Call the recipient and ask whether they would like a human follow-up call. "
    "Record only yes, no, or unknown. Do not collect additional personal "
    "information or make commitments."
)
RESULT_SCHEMA = {
    "type": "object",
    "required": ["wants_human_callback"],
    "properties": {
        "wants_human_callback": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
        }
    },
    "additionalProperties": False,
}


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone", required=True)
    parser.add_argument("--webhook-url", required=True)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized-recipient", action="store_true")
    return parser.parse_args(argv)


def is_public_https_webhook_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return False
    try:
        parsed.port
    except ValueError:
        return False
    try:
        return ipaddress.ip_address(parsed.hostname).is_global
    except ValueError:
        return parsed.hostname.lower() != "localhost" and "." in parsed.hostname


def idempotency_key(
    workflow_id: str,
    phone: str,
    *,
    task: str = TASK,
    result_schema: Mapping[str, Any] = RESULT_SCHEMA,
) -> str:
    intent = {
        "workflow_id": workflow_id,
        "phone": phone,
        "task": task,
        "result_schema": result_schema,
    }
    canonical = json.dumps(intent, sort_keys=True, separators=(",", ":")).encode()
    return f"webhook-result-receiver:{hashlib.sha256(canonical).hexdigest()[:32]}"


def build_call_request(phone: str, webhook_url: str, workflow_id: str) -> dict[str, Any]:
    return {
        "task": TASK,
        "result_schema": RESULT_SCHEMA,
        "metadata": {
            "workflow": "webhook-result-receiver",
            "workflow_id": workflow_id,
        },
        "webhook_url": webhook_url,
        "recipient": {"phone": phone},
        "idempotency_key": idempotency_key(workflow_id, phone),
    }


def default_client_factory(*, api_key: str) -> Any:
    from calle import CalleClient

    return CalleClient(api_key=api_key)


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    client_factory: Callable[..., Any] | None = None,
) -> int:
    args = parse_args(argv)
    if not E164.fullmatch(args.phone):
        sys.stderr.write("error: --phone must use E.164 format\n")
        return 2
    if not WORKFLOW_ID.fullmatch(args.workflow_id):
        sys.stderr.write("error: --workflow-id must use 1-64 safe characters\n")
        return 2
    if not args.execute:
        sys.stdout.write(f"Preview: no call created for {mask_phone(args.phone)}.\n")
        return 0
    if not args.confirm_authorized_recipient:
        sys.stderr.write("error: --execute requires --confirm-authorized-recipient\n")
        return 2
    if not is_public_https_webhook_url(args.webhook_url):
        sys.stderr.write("error: --webhook-url must be a public HTTPS URL\n")
        return 2
    environment = os.environ if environ is None else environ
    api_key = environment.get("CALLE_API_KEY")
    if not api_key:
        sys.stderr.write("error: CALLE_API_KEY is required for --execute\n")
        return 2
    factory = default_client_factory if client_factory is None else client_factory
    created = factory(api_key=api_key).calls.create(
        **build_call_request(args.phone, args.webhook_url, args.workflow_id)
    )
    call_id = created.get("id")
    status = created.get("status")
    if not isinstance(call_id, str) or not call_id:
        sys.stderr.write("error: CALL-E create response did not contain a call ID\n")
        return 2
    sys.stdout.write(f"call_id={call_id} status={status}\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
