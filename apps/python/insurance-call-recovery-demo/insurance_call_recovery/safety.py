from __future__ import annotations
import re

E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")

def validate_e164(number: str) -> None:
    if not E164_RE.fullmatch(number):
        raise ValueError("destination must be an authorized E.164 phone number")

def mask_phone(number: str) -> str:
    if len(number) <= 5:
        return "••••"
    return number[:4] + "•••" + number[-4:]

def require_explicit_approval(approved: bool) -> None:
    if not approved:
        raise PermissionError("explicit approval is required before a live call")

def assert_safe_live_task(task) -> None:
    validate_e164(task.destination)
    if task.task_type == "ambiguous":
        raise ValueError("ambiguous task type requires human clarification")
    if not task.task_description.strip() or not task.intended_outcome.strip():
        raise ValueError("task_description and intended_outcome are required")
