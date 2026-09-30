"""Read a saved official CALL-E CLI get_call_run result without network access.

MCP completion metadata is not the Developer API quote schema. This adapter
never infers prices or recipient mappings from transcripts or free text.
"""
from __future__ import annotations

import re
from typing import Any

from .core import normalize_call_result


_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_TERMINAL = {"COMPLETED", "FAILED", "CANCELED", "CANCELLED", "REJECTED", "DECLINED", "EXPIRED"}


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{label} must be a valid provider identifier")
    return value


def normalize_mcp_result(request: dict[str, Any], saved: Any, expected_run_id: str) -> dict[str, Any]:
    expected = _identifier(expected_run_id, "expected run id")
    if not isinstance(saved, dict) or saved.get("ok") is not True:
        raise ValueError("MCP import requires successful official CLI JSON output")
    if saved.get("tool_name") != "get_call_run":
        raise ValueError("MCP import requires a get_call_run result")
    envelope = saved.get("result")
    if not isinstance(envelope, dict) or envelope.get("isError") is True:
        raise ValueError("MCP result envelope is unsuccessful")
    run = envelope.get("structuredContent")
    if not isinstance(run, dict):
        raise ValueError("MCP result has no structured run metadata")
    run_id = _identifier(run.get("run_id"), "run id")
    if run_id != expected:
        raise ValueError("saved result does not match the expected run id")
    status = run.get("status")
    if not isinstance(status, str) or status not in _TERMINAL:
        raise ValueError("MCP run is not terminal; import never polls or creates a call")
    details = run.get("result")
    if not isinstance(details, dict):
        raise ValueError("MCP run has no result object")
    ids = details.get("call_ids", [])
    if not isinstance(ids, list):
        raise ValueError("MCP call ids must be a list")
    call_ids = [_identifier(value, "call id") for value in ids]
    if len(set(call_ids)) != len(call_ids):
        raise ValueError("MCP result contains duplicate call ids")
    if details.get("call_id") is not None:
        single = _identifier(details["call_id"], "call id")
        if call_ids and single not in call_ids:
            raise ValueError("MCP call identifiers disagree")
        if not call_ids:
            call_ids = [single]
    # No recipient ordering or native quote data is asserted by this import.
    normalized = normalize_call_result(request, {"status": status.lower(), "recipients": []})
    normalized["batch_errors"].append("mcp_result_has_no_native_quote_schema")
    normalized["source"] = {
        "transport": "official_cli_get_call_run_file_import",
        "mcp_run_id": run_id,
        "mcp_call_ids": call_ids,
        "rest_call_id_verified": False,
        "native_quote_schema_available": False,
        "network_attempted": False,
    }
    return normalized
