from __future__ import annotations

from typing import Sequence

from ringdown.checks import Check, all_ok, contradicted

EXIT_ACKNOWLEDGED = 0
EXIT_DECLINED = 10
EXIT_UNACKNOWLEDGED = 20
EXIT_UNKNOWN = 25
EXIT_USAGE = 30
EXIT_UNVERIFIED = 40
EXIT_UNRESOLVED = 45

BY_VERDICT = {
    "acknowledged": EXIT_ACKNOWLEDGED,
    "declined": EXIT_DECLINED,
    "unacknowledged": EXIT_UNACKNOWLEDGED,
    "unknown": EXIT_UNKNOWN,
}


def verifiable(verdict: str, placed: int) -> bool:
    return verdict != "unknown" and bool(placed)


def reconcile(base: int, checks: Sequence[Check]) -> int:
    if all_ok(checks):
        return base
    return EXIT_UNVERIFIED if contradicted(checks) else EXIT_UNRESOLVED


def settle(verdict: str, placed: int, checks: Sequence[Check]) -> int:
    if verdict == "unknown":
        return EXIT_UNKNOWN
    if not placed:
        return EXIT_USAGE
    return reconcile(BY_VERDICT[verdict], checks)
