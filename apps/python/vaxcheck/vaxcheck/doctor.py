"""Environment and credential checks against the live CALL-E service.

Everything here is read-only and none of it can dial. It answers the question
you want answered *before* a session, not during one: is this machine actually
able to place these calls?

  1. Is the `calle` CLI installed and authenticated?
  2. Is the Python SDK importable?
  3. Is CALLE_API_KEY set, and does the live Developer API accept it?
  4. Will CALL-E dial this roster's region/language corridor?

Check 3 issues a real authenticated request to `GET /v1/goals`, which is
read-only and costs nothing. Check 4 issues a real `plan_call`, which validates
the corridor and also costs nothing.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass

from .preflight import PreflightError, cli_path, preflight_student
from .task import Session, Student

OK = "ok"
WARN = "warn"
FAIL = "fail"


@dataclass
class Check:
    name: str
    status: str
    detail: str

    @property
    def mark(self) -> str:
        return {OK: "PASS", WARN: "WARN", FAIL: "FAIL"}[self.status]


def check_cli() -> Check:
    try:
        path = cli_path()
    except PreflightError as exc:
        return Check("calle CLI", FAIL, str(exc))
    try:
        proc = subprocess.run(
            [path, "auth", "status", "--no-telemetry"],
            capture_output=True, text=True, timeout=30, shell=False, check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return Check("calle CLI", FAIL, f"could not run `calle auth status`: {exc}")

    import json

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return Check("calle CLI", FAIL, "unexpected output from `calle auth status`")

    if payload.get("usable"):
        return Check("calle CLI", OK, f"authenticated, token valid to {payload.get('expires_at')}")
    return Check("calle CLI", FAIL, "not authenticated - run `calle auth login`")


def check_sdk() -> Check:
    try:
        import calle  # noqa: F401
    except ImportError:
        return Check(
            "calle-ai SDK", WARN,
            "not installed - needed only for --execute (pip install 'calle-ai>=0.7.0')",
        )
    try:
        from importlib.metadata import version

        return Check("calle-ai SDK", OK, f"version {version('calle-ai')}")
    except Exception:  # noqa: BLE001
        return Check("calle-ai SDK", OK, "installed")


def check_api_key() -> Check:
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        return Check(
            "CALLE_API_KEY", WARN,
            "not set - needed only for --execute "
            "(get one at dashboard.heycall-e.com/account/api-keys)",
        )
    try:
        from calle import CalleClient
    except ImportError:
        return Check("CALLE_API_KEY", WARN, "set, but the SDK is not installed to verify it")

    base_url = os.environ.get("CALLE_BASE_URL")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = CalleClient(**kwargs)
    try:
        # Read-only and free. Proves the key is live and accepted by the API.
        client.goals.list(limit=1)
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if "401" in text or "unauthorized" in text.lower():
            return Check("CALLE_API_KEY", FAIL, "rejected by the API (401) - key is invalid")
        return Check("CALLE_API_KEY", WARN, f"set, but the check failed: {text[:160]}")
    return Check("CALLE_API_KEY", OK, "accepted by the live Developer API")


_CORRIDOR_WORDS = re.compile(
    r"region|language|country|corridor|not (currently )?supported|unsupported",
    re.IGNORECASE,
)


def classify_blockers(blockers: list[str]) -> tuple[str, str]:
    """Separate a dead corridor from a planner asking about the goal.

    `plan_call` returns clarifying questions for both. A corridor refusal is a
    hard FAIL: no call can be placed. A question about the goal's wording is a
    WARN: the corridor is fine, the instruction needs tightening.
    """
    if not blockers:
        return FAIL, "plan_call was not ready to run and gave no reason"
    corridor = [b for b in blockers if _CORRIDOR_WORDS.search(b)]
    if corridor:
        return FAIL, corridor[0]
    return WARN, f"corridor accepted; planner asked about the goal: {blockers[0]}"


def check_corridor(session: Session, student: Student) -> Check:
    try:
        result = preflight_student(session, student)
    except PreflightError as exc:
        return Check("region corridor", FAIL, str(exc))
    if result.ready:
        return Check(
            "region corridor", OK,
            f"{session.region}/{session.language} accepted by plan_call",
        )
    status, detail = classify_blockers(result.blockers)
    return Check("region corridor", status, detail)


def run(session: Session, student: Student | None = None) -> list[Check]:
    checks = [check_cli(), check_sdk(), check_api_key()]
    if student is not None:
        checks.append(check_corridor(session, student))
    return checks


def render(checks: list[Check]) -> str:
    width = max(len(c.name) for c in checks)
    lines = ["Live environment check (read-only; nothing here can place a call)", ""]
    for c in checks:
        lines.append(f"  {c.mark}  {c.name.ljust(width)}  {c.detail}")
    failed = [c for c in checks if c.status == FAIL]
    warned = [c for c in checks if c.status == WARN]
    lines.append("")
    if failed:
        lines.append(f"  {len(failed)} blocking problem(s). --execute will not work yet.")
    elif warned:
        lines.append("  Ready for --preview, --mock and --preflight.")
        lines.append("  Resolve the warnings above before --execute.")
    else:
        lines.append("  Ready to place real calls.")
    return "\n".join(lines)
