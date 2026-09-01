"""CALL-E clients: fixture dry-run client and live MCP Streamable HTTP client."""
import asyncio
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol

from .models import CallOutcome, CallStatus
from .stores import read_jsonl

DEFAULT_BASE_URL = "https://seleven-mcp-sg.airudder.com"
DEFAULT_CHANNEL = "openagent_oauth"
DEFAULT_CACHE_ROOT = "~/.calle-mcp/cli"
INTEGRATION_HEADER = "apps/python/table-rescue/0.0.0"
TERMINAL_STATUSES = {
    "BUSY",
    "CANCELED",
    "CANCELLED",
    "COMPLETED",
    "DECLINED",
    "EXPIRED",
    "FAILED",
    "NO_ANSWER",
    "VOICEMAIL",
}
OUTCOME_RE = re.compile(r"OUTCOME:\s*([A-Z_]+)")

CONFIRM_GOAL = (
    "You are calling {name} about their restaurant reservation for a party of "
    "{party_size} at {slot}. Ask whether they will keep the booking, cancel it, or move "
    "it to another time; if they want another time, agree on a new slot. End the call by "
    "stating exactly one of: OUTCOME: CONFIRMED, OUTCOME: CANCELLED, OUTCOME: RESCHEDULED, "
    "or OUTCOME: NO_ANSWER."
)

OFFER_GOAL = (
    "You are calling {name} from a restaurant waitlist. A table for a party of "
    "{party_size} just became available at {slot}. Ask whether they accept the table. "
    "End the call by stating exactly one of: OUTCOME: ACCEPTED, OUTCOME: DECLINED, or "
    "OUTCOME: NO_ANSWER."
)


@dataclass(frozen=True)
class CallRequest:
    run_id: str
    target_id: str
    phone: str
    goal: str


class CallClient(Protocol):
    def place_call(self, request: CallRequest) -> CallOutcome: ...


def build_confirm_goal(name: str, party_size: int, slot: str) -> str:
    return CONFIRM_GOAL.format(name=name, party_size=party_size, slot=slot)


def build_offer_goal(name: str, party_size: int, slot: str) -> str:
    return OFFER_GOAL.format(name=name, party_size=party_size, slot=slot)


def parse_outcome(summary: str | None) -> CallStatus | None:
    if not summary:
        return None
    match = OUTCOME_RE.search(summary)
    if not match:
        return None
    try:
        return CallStatus(match.group(1))
    except ValueError:
        return None


def map_terminal_status(status: str, summary: str | None) -> CallStatus:
    if status == "COMPLETED":
        return parse_outcome(summary) or CallStatus.ERROR
    if status in {"NO_ANSWER", "BUSY", "VOICEMAIL"}:
        return CallStatus.NO_ANSWER
    if status == "DECLINED":
        return CallStatus.DECLINED
    return CallStatus.ERROR


def compact_summary(summary: Any) -> str | None:
    if not summary:
        return None
    return " ".join(str(summary).split())[:200]


class DryRunClient:
    """Returns fixture outcomes keyed by target_id; never touches the network."""

    def __init__(self, fixture_path: str | Path):
        self._outcomes = {row["target_id"]: row for row in read_jsonl(fixture_path)}
        self._default = self._outcomes.get("DEFAULT")

    def place_call(self, request: CallRequest) -> CallOutcome:
        payload = self._outcomes.get(request.target_id, self._default)
        if payload is None:
            raise KeyError(
                f"no dry-run fixture for target {request.target_id} and no DEFAULT row"
            )
        return CallOutcome.from_payload(request.run_id, request.target_id, payload)
