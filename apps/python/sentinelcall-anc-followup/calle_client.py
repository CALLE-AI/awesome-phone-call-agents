"""
calle_client.py

Rewritten to use the `calle` CLI directly (the proven working path:
calle call plan / calle call run / calle call status), instead of the raw
REST API this file originally assumed. No CALLE_BASE_URL or CALLE_API_KEY
needed — auth is handled entirely by `calle auth login`, already done.
"""

import subprocess
import json


class CalleError(Exception):
    pass


def _run_calle(args: list[str]) -> dict:
    """Run a `calle` CLI command and parse its JSON output."""
    result = subprocess.run(
        ["calle"] + args,
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode != 0:
        raise CalleError(f"calle CLI failed: {result.stderr or result.stdout}")

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise CalleError(f"Could not parse calle CLI output as JSON: {result.stdout}")


def plan_call(phone: str, goal: str, region: str, language: str = "English") -> dict:
    """
    Plan a call. Returns the parsed response, which includes:
      - plan_id
      - ready_to_run (bool)
      - confirm_token (only present if ready_to_run is True)
      - clarifying_questions (if more info is needed)
    """
    response = _run_calle([
        "call", "plan",
        "--to-phone", phone,
        "--goal", goal,
        "--region", region,
        "--language", language,
        "--timeout-seconds", "60",
    ])
    structured = response.get("result", {}).get("structuredContent", response)
    return structured


def run_call(plan_id: str, confirm_token: str) -> dict:
    """Execute a planned call. Returns a dict including run_id and initial status."""
    response = _run_calle([
        "call", "run",
        "--plan-id", plan_id,
        "--confirm-token", confirm_token,
    ])
    structured = response.get("result", {}).get("structuredContent", response)
    return structured


def get_call_status(run_id: str) -> dict:
    """Poll a call run. Returns status + result (transcript, extracted data) once terminal."""
    response = _run_calle([
        "call", "status",
        "--run-id", run_id,
    ])
    structured = response.get("result", {}).get("structuredContent", response)
    return structured


TERMINAL_STATUSES = {"COMPLETED", "NO ANSWER", "DECLINED", "FAILED"}


def wait_for_call_result(run_id: str, poll_interval_seconds: int = 3, max_wait_seconds: int = 120) -> dict:
    """Poll get_call_status until a terminal status is reached or max_wait_seconds elapses."""
    import time
    waited = 0
    while waited < max_wait_seconds:
        status = get_call_status(run_id)
        if status.get("status") in TERMINAL_STATUSES:
            return status
        time.sleep(poll_interval_seconds)
        waited += poll_interval_seconds
    raise CalleError(f"Call {run_id} did not reach a terminal status within {max_wait_seconds}s")