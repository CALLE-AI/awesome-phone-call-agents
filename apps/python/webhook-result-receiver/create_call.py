"""Preview or explicitly create one CALL-E human-follow-up call."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from urllib.parse import urlparse

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
WORKFLOW_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DNS_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
LEGACY_NUMERIC_HOST = re.compile(r"^(?:[0-9]+|0[xX][0-9A-Fa-f]+)$")
SAFE_PROVIDER_TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
API_TIMEOUT_SECONDS = 10.0
SPECIAL_USE_SUFFIXES = {
    "alt",
    "arpa",
    "example",
    "home",
    "home.arpa",
    "internal",
    "invalid",
    "ip6.arpa",
    "in-addr.arpa",
    "lan",
    "local",
    "localdomain",
    "localhost",
    "onion",
    "test",
}
RESERVED_EXAMPLE_DOMAINS = {"example.com", "example.net", "example.org"}
CALL_STATUSES = {"queued", "in_progress", "completed", "failed", "canceled"}
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


def _is_name_or_subdomain(hostname: str, suffix: str) -> bool:
    return hostname == suffix or hostname.endswith(f".{suffix}")


def _is_globally_routable(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address,
) -> bool:
    return (
        address.is_global
        and not address.is_multicast
        and not address.is_unspecified
        and not address.is_reserved
        and not address.is_loopback
        and not address.is_link_local
        and not address.is_private
        and not getattr(address, "is_site_local", False)
    )


def _valid_public_host_syntax(hostname: str) -> bool:
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        return _is_globally_routable(address)

    try:
        hostname.encode("ascii")
    except UnicodeEncodeError:
        return False
    if len(hostname) > 253:
        return False
    labels = hostname.split(".")
    if len(labels) < 2 or any(DNS_LABEL.fullmatch(label) is None for label in labels):
        return False
    if all(LEGACY_NUMERIC_HOST.fullmatch(label) is not None for label in labels):
        return False
    blocked_names = SPECIAL_USE_SUFFIXES | RESERVED_EXAMPLE_DOMAINS
    return not any(_is_name_or_subdomain(hostname, name) for name in blocked_names)


def default_resolver(hostname: str) -> list[str]:
    results = socket.getaddrinfo(
        hostname,
        443,
        family=socket.AF_UNSPEC,
        type=socket.SOCK_STREAM,
    )
    return [
        str(sockaddr[0])
        for family, _type, _protocol, _canonname, sockaddr in results
        if family in {socket.AF_INET, socket.AF_INET6}
    ]


def is_public_https_webhook_url(
    value: str,
    *,
    resolver: Callable[[str], Iterable[str]] | None = None,
) -> bool:
    if any(
        character.isspace()
        or character == "\\"
        or ord(character) < 0x20
        or ord(character) == 0x7F
        for character in value
    ):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    try:
        parsed.netloc.encode("ascii")
    except UnicodeEncodeError:
        return False
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or "@" in parsed.netloc
        or parsed.path != "/calle/webhook"
        or bool(parsed.params)
        or "?" in value
        or "#" in value
    ):
        return False
    try:
        _ = parsed.port
    except ValueError:
        return False
    hostname = parsed.hostname.lower()
    if hostname.endswith(".."):
        return False
    hostname = hostname.removesuffix(".")
    if not hostname or not _valid_public_host_syntax(hostname):
        return False
    if resolver is None:
        return True
    try:
        addresses = list(resolver(hostname))
    except Exception:  # noqa: BLE001 - DNS failure is a private validation failure.
        return False
    if not addresses:
        return False
    for raw_address in addresses:
        if not isinstance(raw_address, str):
            return False
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError:
            return False
        if not _is_globally_routable(address):
            return False
    return True


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
    canonical = json.dumps(
        intent,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    return f"webhook-result-receiver:{hashlib.sha256(canonical).hexdigest()[:32]}"


def build_call_request(
    phone: str, webhook_url: str, workflow_id: str
) -> dict[str, Any]:
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

    return CalleClient(api_key=api_key, timeout=API_TIMEOUT_SECONDS)


def _sdk_exception_types() -> tuple[type[BaseException], ...]:
    from calle import (
        CalleAPIError,
        CalleAuthenticationError,
        CalleConnectionError,
        CalleRateLimitError,
        CalleTimeoutError,
    )

    return (
        CalleAuthenticationError,
        CalleRateLimitError,
        CalleAPIError,
        CalleConnectionError,
        CalleTimeoutError,
    )


def _write_creation_error(code: str) -> None:
    if code == "call_creation_outcome_unknown":
        sys.stderr.write(
            "error: call_creation_outcome_unknown; retry only the identical intent "
            "so the stable idempotency key is reused\n"
        )
        return
    sys.stderr.write(f"error: {code}\n")


def _close_client_privately(client: object) -> None:
    try:
        client.close()
    except Exception:  # noqa: BLE001 - never leak cleanup details.
        return


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    client_factory: Callable[..., Any] | None = None,
    resolver: Callable[[str], Iterable[str]] | None = None,
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
    if not isinstance(api_key, str) or not api_key.strip():
        sys.stderr.write("error: CALLE_API_KEY is required for --execute\n")
        return 2
    resolve = default_resolver if resolver is None else resolver
    if not is_public_https_webhook_url(args.webhook_url, resolver=resolve):
        sys.stderr.write("error: --webhook-url must be a public HTTPS URL\n")
        return 2
    factory = default_client_factory if client_factory is None else client_factory
    try:
        (
            authentication_error,
            rate_limit_error,
            api_error,
            connection_error,
            timeout_error,
        ) = _sdk_exception_types()
    except Exception:  # noqa: BLE001 - SDK initialization uses a private code.
        _write_creation_error("call_creation_failed")
        return 1
    client = None
    created = None
    failure_code = None
    try:
        client = factory(api_key=api_key)
        created = client.calls.create(
            **build_call_request(args.phone, args.webhook_url, args.workflow_id)
        )
    except (connection_error, timeout_error):
        failure_code = "call_creation_outcome_unknown"
    except (json.JSONDecodeError, UnicodeError, RecursionError, EOFError):
        failure_code = "call_creation_outcome_unknown"
    except authentication_error:
        failure_code = "call_creation_authentication_failed"
    except rate_limit_error:
        failure_code = "call_creation_rate_limited"
    except api_error:
        failure_code = "call_creation_api_error"
    except Exception:  # noqa: BLE001 - live failures use one private code.
        failure_code = "call_creation_failed"
    finally:
        if client is not None:
            _close_client_privately(client)
    if failure_code is not None:
        _write_creation_error(failure_code)
        return 1
    call_id = created.get("id") if isinstance(created, dict) else None
    status = created.get("status") if isinstance(created, dict) else None
    if (
        not isinstance(call_id, str)
        or SAFE_PROVIDER_TOKEN.fullmatch(call_id) is None
        or not isinstance(status, str)
        or status not in CALL_STATUSES
    ):
        _write_creation_error("call_creation_outcome_unknown")
        return 1
    sys.stdout.write(f"call_id={call_id} status={status}\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
