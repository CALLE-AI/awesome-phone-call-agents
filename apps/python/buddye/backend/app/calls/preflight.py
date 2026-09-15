"""CALL-E connection preflight. Reports what is wired without placing, planning, or scheduling any call.

- SDK: package importable, API key present (never echoed), base URL.
- CLI: `calle auth status` (reads the local token cache; no network).
- MCP: `calle mcp tools` (network tools/list; no call). Cached for 60 s.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import time
from typing import Any

from app.calls.guards import UnapprovedBaseUrl, approved_calle_base_url, is_strict_e164
from app.config import Settings
from app.orchestrator.reconcile import reconciler_name

# Attribution goes through the environment: the installed CLI (0.5.x) rejects the --source flags.
ATTRIBUTION_ENV = {"CALLE_SOURCE": "buddye", "CALLE_INTEGRATION": "buddye_app", "CALLE_INTEGRATION_VERSION": "0.1.0"}
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_S = 60.0


def _run_cli(bin_: str, argv: list[str], timeout: float) -> dict[str, Any]:
    try:
        proc = subprocess.run([bin_, *argv], capture_output=True, text=True, timeout=timeout, check=False, env={**os.environ, **ATTRIBUTION_ENV})  # noqa: S603
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": type(exc).__name__}
    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "non_json_output", "exit_code": proc.returncode}
    if not isinstance(data, dict):
        return {"ok": False, "error": "unexpected_output"}
    data.setdefault("ok", proc.returncode == 0)
    return data


def sdk_status(settings: Settings) -> dict[str, Any]:
    importable = importlib.util.find_spec("calle") is not None
    version = None
    if importable:
        try:
            from importlib.metadata import version as _v

            version = _v("calle-ai")
        except Exception:  # noqa: BLE001
            version = None
    return {"importable": importable, "version": version, "api_key_present": bool(settings.CALLE_API_KEY), "base_url": settings.CALLE_BASE_URL}


def cli_status(settings: Settings) -> dict[str, Any]:
    bin_path = shutil.which(settings.CALLE_CLI_BIN)
    if not bin_path:
        return {"found": False}
    data = _run_cli(settings.CALLE_CLI_BIN, ["auth", "status"], timeout=10)
    return {"found": True, "authenticated": bool(data.get("usable")), "expires_at": data.get("expires_at"), "server_url": data.get("server_url")}


def mcp_status(settings: Settings, *, authenticated: bool) -> dict[str, Any]:
    if not authenticated:
        return {"reachable": False, "tools": [], "reason": "cli_not_authenticated"}
    now = time.monotonic()
    hit = _cache.get("mcp")
    if hit and now - hit[0] < CACHE_S:
        return hit[1]
    data = _run_cli(settings.CALLE_CLI_BIN, ["mcp", "tools"], timeout=20)
    tools: list[str] = []
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    for t in (result.get("tools") or data.get("tools") or []):
        if isinstance(t, dict) and isinstance(t.get("name"), str):
            tools.append(t["name"])
    out = {"reachable": bool(data.get("ok")) and bool(tools), "tools": tools, "server_url": data.get("server_url")}
    if not out["reachable"]:
        out["reason"] = data.get("error") or "no_tools_listed"
    _cache["mcp"] = (now, out)
    return out


async def preflight(settings: Settings, *, budget_used: int) -> dict[str, Any]:
    sdk = sdk_status(settings)
    cli = await asyncio.to_thread(cli_status, settings)
    mcp = await asyncio.to_thread(mcp_status, settings, authenticated=bool(cli.get("authenticated")))
    provider = settings.CALL_PROVIDER
    ready = {
        "mock": True,
        "calle_sdk": sdk["importable"] and sdk["api_key_present"],
        "calle_mcp": bool(cli.get("authenticated")) and mcp["reachable"],
    }[provider]
    return {
        "provider": provider,
        "ready": ready,
        "live": provider != "mock",
        "sdk": sdk,
        "cli": cli,
        "mcp": mcp,
        "allowlist_count": len(settings.dialable_numbers),
        "budget": {"max": settings.CALL_BUDGET_MAX, "used": budget_used, "remaining": max(0, settings.CALL_BUDGET_MAX - budget_used), "enforced": True},
        "webhook_configured": bool(settings.PUBLIC_BASE_URL),
        "split_coverage_enabled": settings.ENABLE_SPLIT_COVERAGE,
        "require_manager_approval": settings.REQUIRE_MANAGER_APPROVAL,
        "reconciler": reconciler_name(settings),
    }


_snapshot: dict[str, Any] | None = None


async def refresh_snapshot(settings: Settings, *, budget_used: int) -> dict[str, Any]:
    global _snapshot
    _snapshot = await preflight(settings, budget_used=budget_used)
    _snapshot["checked_at"] = time.time()
    return _snapshot


def snapshot() -> dict[str, Any] | None:
    return _snapshot


async def refresh_loop(settings: Settings, budget_used_fn, interval_s: float = 60.0) -> None:  # noqa: ANN001
    """Background refresher so GET /api/calle/status answers instantly from the last snapshot."""
    while True:
        try:
            await refresh_snapshot(settings, budget_used=budget_used_fn())
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(interval_s)


def validate_startup(settings: Settings) -> list[str]:
    """Misconfigurations that should stop the process rather than surface on the first fill."""
    problems: list[str] = []
    if settings.CALL_PROVIDER == "calle_sdk" and not settings.CALLE_API_KEY:
        problems.append("CALL_PROVIDER=calle_sdk requires CALLE_API_KEY")
    if settings.CALL_PROVIDER == "calle_mcp" and not shutil.which(settings.CALLE_CLI_BIN):
        problems.append(f"CALL_PROVIDER=calle_mcp requires the `{settings.CALLE_CLI_BIN}` CLI on PATH")
    if settings.is_real_provider and not settings.dialable_numbers:
        problems.append("a real CALL_PROVIDER with an empty DIALABLE_NUMBERS would skip every candidate; set the allowlist or use CALL_PROVIDER=mock")
    malformed = [n for n in settings.dialable_numbers if not is_strict_e164(n)]
    if malformed:
        problems.append(f"DIALABLE_NUMBERS has {len(malformed)} entry(ies) that are not ASCII E.164 (+ then digits, no spaces or punctuation)")
    if settings.CALL_PROVIDER == "calle_sdk":
        try:
            approved_calle_base_url(settings.CALLE_BASE_URL)
        except UnapprovedBaseUrl as exc:
            problems.append(str(exc))
    if settings.is_real_provider and settings.CALL_BUDGET_MAX <= 0:
        problems.append("CALL_BUDGET_MAX must be > 0 for a real provider")
    return problems
