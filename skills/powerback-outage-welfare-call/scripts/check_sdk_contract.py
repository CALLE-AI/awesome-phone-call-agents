# -*- coding: utf-8 -*-
"""Assert the live request matches the published calle-ai==1.0.1 contract.

Runs offline. No API key, no network, no SDK installed, no call placed.

The reference signature below is transcribed from `CalleCalls.create` in
calle-ai 1.0.1 (CALLE-AI/server-sdk-python, tag v1.0.1, src/calle/calls.py).
`create_and_wait(**kwargs)` forwards everything except `interval_seconds` and
`timeout_seconds` to it, so binding against this signature is what actually
decides whether a live request would be accepted or raise TypeError.

    python scripts/check_sdk_contract.py
"""
import inspect
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.adapters import CALLE_SDK_VERSION, RealAdapter  # noqa: E402

JsonObject = dict


def _published_create_signature(
    *,
    task: str,
    phone: str,
    region=None,
    locale=None,
    idempotency_key: str,
    result_schema: JsonObject,
    metadata=None,
    webhook_url=None,
):
    """Transcribed from calle-ai 1.0.1. Body intentionally unused."""


# Profile limits from the SDK README: calle.result.scalar-object.v1.
SCALAR_TYPES = {"string", "number", "integer", "boolean"}
MAX_PROPERTIES = 32

CASE = {
    "case_id": "PB-SIM-01-OK",
    "phone": "+886900000001",
    "scenario": "outage_welfare_check",
    "language": "en",
    "disclosure_allowlist": ["caller_identity"],
}


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + (f" - {detail}" if detail else ""))
    return bool(condition)


def main() -> int:
    print(f"Checking the live request against calle-ai=={CALLE_SDK_VERSION}")
    print("(offline: no API key, no network, no SDK import, no call placed)\n")

    os.environ["PB_ALLOWED_DESTINATIONS"] = CASE["phone"]
    adapter = RealAdapter()
    key = adapter.idempotency_key(CASE, batch_id="2026-10-12-demo")
    request = adapter.build_request(CASE, "task text", key)

    ok = True
    sig = inspect.signature(_published_create_signature)
    try:
        sig.bind(**request)
        ok &= check("request binds to the published create() signature", True)
    except TypeError as exc:
        ok &= check("request binds to the published create() signature", False, str(exc))

    ok &= check("destination is sent as 'phone' (SDK 1.0 removed recipient/recipients)",
                "phone" in request and "recipient" not in request
                and "recipients" not in request and "to" not in request)
    ok &= check("idempotency_key is present and non-blank",
                bool(request.get("idempotency_key", "").strip()), key)
    ok &= check("result_schema is present", bool(request.get("result_schema")))

    schema = request.get("result_schema") or {}
    props = schema.get("properties", {})
    ok &= check("result_schema sets additionalProperties: false",
                schema.get("additionalProperties") is False)
    ok &= check(f"result_schema has at most {MAX_PROPERTIES} properties",
                len(props) <= MAX_PROPERTIES, f"{len(props)} properties")

    non_scalar = sorted(
        name for name, spec in props.items()
        if not isinstance(spec.get("type"), str) or spec.get("type") not in SCALAR_TYPES
    )
    ok &= check("every property is a scalar type (no arrays, no nullable unions)",
                not non_scalar, ", ".join(non_scalar))

    required = schema.get("required", [])
    ok &= check("every required property is declared",
                all(name in props for name in required), ", ".join(required))

    print("\nRequest that would be sent (task text elided, number is a synthetic fixture):")
    preview = dict(request, task="<task text>")
    print(json.dumps(preview, indent=2, sort_keys=True))

    print("\n" + ("Contract check passed." if ok else "Contract check FAILED."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
