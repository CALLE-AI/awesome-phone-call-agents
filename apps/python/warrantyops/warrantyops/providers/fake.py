"""A provider that returns recorded synthetic calls and places none.

Every fixture it can return is a file in ``fixtures/``, written by hand, using
numbers from the reserved fictional range. The provider holds no network client
and imports no HTTP library; the test suite additionally proves it by making
socket creation raise for the duration of a run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from ..identifiers import TranscriptTurn
from ..outcome import TransportOutcome, TransportState
from .base import CallRequest, ProviderCall

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures"


class ZeroCallViolation(RuntimeError):
    """Raised when something asks the fake provider to behave like a real one."""


@dataclass
class FakeCallProvider:
    """Replay one synthetic scenario. ``calls_placed`` always stays zero."""

    scenario: str
    fixture_dir: Path = FIXTURE_DIR
    name: str = "fake"
    calls_placed: int = 0
    replays: int = 0
    #: Replays a recording; cannot dial anything, so it accepts the
    #: non-durable in-memory ledger the CLI demo uses.
    requires_durable_ledger: bool = False

    def load(self) -> dict[str, Any]:
        path = self.fixture_dir / f"{self.scenario}.json"
        if not path.exists():
            available = ", ".join(sorted(p.stem for p in self.fixture_dir.glob("*.json")))
            raise FileNotFoundError(
                f"unknown scenario {self.scenario!r}; available: {available}"
            )
        fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return fixture

    def place_call(
        self,
        request: CallRequest,
        on_call_created: Optional[Callable[[str], None]] = None,
    ) -> ProviderCall:
        fixture = self.load()
        expected = fixture.get("recipient_e164")
        if expected and expected != request.recipient_e164:
            raise ZeroCallViolation(
                "fixture recipient does not match the authorized recipient"
            )
        self.replays += 1
        transport = TransportOutcome(
            state=TransportState(fixture["transport"]["state"]),
            call_id=fixture["transport"].get("call_id"),
            diagnostic_failure_code=fixture["transport"].get("failure_code"),
            diagnostic_failure_message=fixture["transport"].get("failure_message"),
        )
        # The synthetic "creation" is replaying the fixture: report its call
        # id the way the live provider reports the vendor's, before any
        # status is read.
        if on_call_created is not None and transport.call_id:
            on_call_created(transport.call_id)
        return ProviderCall(
            transport=transport,
            structured_result=fixture.get("structured_result"),
            transcript=tuple(
                TranscriptTurn(speaker=turn["speaker"], text=turn["text"])
                for turn in fixture.get("transcript_turns", ())
            ),
            raw={"scenario": self.scenario, "idempotency_key": request.idempotency_key},
        )
