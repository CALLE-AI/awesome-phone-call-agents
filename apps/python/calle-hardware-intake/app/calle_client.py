"""Thin wrapper around the ``calle`` CLI (CALL-E).

CALL-E owns the phone conversation. The flow is:

    plan_call(to_phone, goal) -> {plan_id, confirm_token, ready_to_run, ...}
    run_call(plan_id, confirm_token) -> {run_id, ...}
    get_call_status(run_id) -> {status, summary, transcript, ...}

``calle`` is authenticated once via ``calle auth login`` (OAuth). These are
sync functions that block for the duration of the subprocess; call them from
async code with ``asyncio.to_thread``.
"""
import json
import os
import shutil
import subprocess

from .config import settings


class CalleError(Exception):
    """Raised when the calle CLI fails."""


def _get(data: dict, *keys):
    """Case-insensitive, multi-spelling lookup of a key in a dict."""
    lowered = {str(k).lower(): v for k, v in (data or {}).items()}
    for key in keys:
        if key in data:
            return data[key]
        if key.lower() in lowered:
            return lowered[key.lower()]
    return None


def _unwrap(data: dict) -> dict:
    """Dig the payload out of the CLI's wrapper envelope.

    ``calle`` emits ``{"ok": true, "result": {"structuredContent": {...}}|...}``
    (or the same object JSON-stringified under ``result.content[0].text``).
    Return the innermost dict of actual data.
    """
    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return data
    sc = result.get("structuredContent")
    if isinstance(sc, dict):
        return sc
    content = result.get("content")
    if isinstance(content, list) and content:
        text = content[0].get("text")
        if isinstance(text, str):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
    return result


def cli_command(args: list[str]) -> list[str]:
    """Resolve the `calle` CLI to an executable subprocess can actually run.

    npm installs `calle.cmd` shims on Windows; Python's subprocess cannot run
    a `.cmd` via PATH (only `.exe`), so we resolve the real path and delegate
    to ``cmd /c`` when needed.
    """
    exe = shutil.which(settings.calle_cli)
    if not exe:
        return [settings.calle_cli, *args]
    if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", exe, *args]
    return [exe, *args]


def _run(args: list[str], timeout: int = 600) -> dict:
    proc = subprocess.run(
        cli_command(args),
        capture_output=True,
        text=True,
        encoding="utf-8",  # calle emits UTF-8; cp1252 would crash on typographic chars
        errors="replace",
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise CalleError(f"calle {' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise CalleError(f"calle returned non-JSON: {proc.stdout[:300]!r}") from exc
    if isinstance(data, dict) and data.get("ok") is False:
        # The CLI exits 0 even on logical failures (e.g. transient call errors).
        msg = data.get("result")
        if isinstance(msg, dict):
            msg = msg.get("content") or msg
        raise CalleError(f"calle {args[0]} failed: {str(msg)[:300]}")
    return data


def plan_call(to_phone: str, goal: str) -> dict:
    """Plan a call. Does NOT dial. Returns plan_id/confirm_token/ready_to_run."""
    return _run(["call", "plan", "--to-phone", to_phone, "--goal", goal])


def run_call(plan_id: str, confirm_token: str, timeout: int = 600) -> dict:
    """Execute a planned call; blocks until the call finishes."""
    return _run(
        ["call", "run", "--plan-id", plan_id, "--confirm-token", confirm_token],
        timeout=timeout,
    )


def get_call_status(run_id: str) -> dict:
    """Fetch the latest status of a running/completed call."""
    return _run(["call", "status", "--run-id", run_id])


def extract_plan(data: dict) -> dict:
    """Normalize a plan_call response."""
    data = _unwrap(data)
    return {
        "plan_id": _get(data, "plan_id", "planId"),
        "confirm_token": _get(data, "confirm_token", "confirmToken"),
        "ready_to_run": _get(data, "ready_to_run", "readyToRun"),
        "clarifying_questions": _get(data, "clarifying_questions", "questions"),
    }


def extract_run(data: dict) -> dict:
    """Normalize a run_call / get_call_status response."""
    data = _unwrap(data)
    nested = data.get("result") if isinstance(data.get("result"), dict) else {}

    def find(*keys):
        # summary/transcript/outcome live under `result` in the payload.
        v = _get(data, *keys)
        if v is None:
            v = _get(nested, *keys)
        return v

    return {
        "run_id": _get(data, "run_id", "runId"),
        "status": find("status"),
        "summary": find("summary", "call_summary"),
        "transcript": find("transcript"),
        "outcome": find("outcome", "task_completed"),
        "result": _get(data, "result", "structured_result", "structuredResult"),
    }
