"""Live CALL-E preflight - real API call, no phone call.

`plan_call` is a real authenticated request to CALL-E that validates a call
before anything is dialled: it resolves the recipient's region, checks the
region/language corridor, and reports whether the goal is complete enough to
run. It does not place a call and does not consume call quota.

That makes it the right thing to run before a school session. A roster of 200
guardians is worth validating in advance rather than discovering on the morning
that a corridor is unsupported or a number is malformed.

Requires the `calle` CLI, authenticated with `calle auth login`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from .task import Session, Student, preflight_goal


class PreflightError(RuntimeError):
    pass


@dataclass
class PreflightResult:
    student_id: str
    masked_phone: str
    ready: bool
    blockers: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "student_id": self.student_id,
            "guardian_phone": self.masked_phone,
            "ready_to_run": self.ready,
            "blockers": list(self.blockers),
        }


def cli_path() -> str:
    override = os.environ.get("CALLE_CLI")
    if override:
        return override
    found = shutil.which("calle")
    if not found:
        raise PreflightError(
            "the 'calle' CLI was not found. Install it with "
            "`npm install -g @call-e/cli`, run `calle auth login`, or set CALLE_CLI "
            "to its absolute path."
        )
    return found


def preflight_student(
    session: Session,
    student: Student,
    *,
    timeout: int = 180,
) -> PreflightResult:
    """Run one live `plan_call`. Never dials."""
    argv = [
        cli_path(),
        "call",
        "plan",
        "--to-phone",
        student.guardian_phone,
        "--region",
        session.region,
        "--language",
        session.language,
        "--goal",
        preflight_goal(session, student),
        "--no-telemetry",
    ]
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise PreflightError(f"plan_call timed out after {timeout}s") from exc

    if proc.returncode != 0 and not proc.stdout.strip():
        raise PreflightError(
            f"calle call plan failed: {(proc.stderr or '').strip()[:300]}"
        )

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise PreflightError(f"could not parse plan_call output: {exc}") from exc

    structured = (payload.get("result") or {}).get("structuredContent") or {}
    ready = bool(structured.get("ready_to_run"))
    blockers = [
        str(q) for q in (structured.get("clarifying_questions") or []) if q is not None
    ]
    return PreflightResult(
        student_id=student.student_id,
        masked_phone=student.masked_phone,
        ready=ready,
        blockers=blockers,
    )


def preflight_roster(
    session: Session,
    students: list[Student],
    *,
    limit: int | None = None,
) -> list[PreflightResult]:
    targets = students if limit is None else students[:limit]
    return [preflight_student(session, s) for s in targets]
