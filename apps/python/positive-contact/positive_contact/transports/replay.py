"""Replay transport: adjudicate stored payloads without a network.

Replay exists to prove the adjudicator against response shapes it did not author. Each
file in `fixtures/recorded/` carries a `source` field:

- `live-redacted` means the payload was captured from a real CALL-E call by `pc record`
  and passed through the redactor before it was written to disk.
- `synthetic-contract-shape` means it was written against the published OpenAPI contract
  rather than captured. It still exercises the parser and the judges, but it is not
  evidence that the live API behaves this way.

`pc run --mode replay` prints which of the two it is working from, so a run against
synthetic payloads can never be reported as a live verification.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from .base import CallSnapshot, SubmitResult, TransportError, parse_call_task

LIVE_REDACTED = "live-redacted"
SYNTHETIC = "synthetic-contract-shape"
KNOWN_SOURCES = frozenset({LIVE_REDACTED, SYNTHETIC})


class RecordingError(TransportError):
    """Raised when a recorded payload cannot be trusted to stand in for a real one."""


class ReplayTransport:
    """Serves stored `CallTask` payloads through the same interface as the live API."""

    def __init__(self, recorded_dir: Path | str) -> None:
        self.recorded_dir = Path(recorded_dir)
        self.recordings: dict[tuple[str, int], dict] = {}
        self.sources: dict[str, str] = {}
        self._by_call_id: dict[str, dict] = {}
        self._by_key: dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        if not self.recorded_dir.is_dir():
            raise RecordingError(f"no recorded payload directory at {self.recorded_dir}")
        for path in sorted(self.recorded_dir.glob("*.json")):
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise RecordingError(f"could not read recording {path.name}: {exc}") from exc
            source = document.get("source")
            if source not in KNOWN_SOURCES:
                raise RecordingError(
                    f"recording {path.name} must declare source as one of "
                    f"{', '.join(sorted(KNOWN_SOURCES))}"
                )
            match = document.get("match") or {}
            call_task = document.get("call_task")
            if not isinstance(call_task, dict):
                raise RecordingError(f"recording {path.name} has no call_task object")
            try:
                key = (str(match["contact_id"]), int(match["ladder_step"]))
            except (KeyError, TypeError, ValueError) as exc:
                raise RecordingError(
                    f"recording {path.name} needs match.contact_id and match.ladder_step"
                ) from exc
            self.recordings[key] = call_task
            self.sources[path.name] = source
        if not self.recordings:
            raise RecordingError(
                f"no recorded payloads in {self.recorded_dir}; run `pc record` after a live "
                "call, or use --mode fixture"
            )

    @property
    def has_live_recordings(self) -> bool:
        return any(source == LIVE_REDACTED for source in self.sources.values())

    def provenance_line(self) -> str:
        live = sum(1 for source in self.sources.values() if source == LIVE_REDACTED)
        synthetic = sum(1 for source in self.sources.values() if source == SYNTHETIC)
        parts = []
        if live:
            parts.append(f"{live} captured from live calls and redacted")
        if synthetic:
            parts.append(f"{synthetic} written against the published contract, not captured")
        return "replaying " + ", ".join(parts)

    # -- CallTransport ----------------------------------------------------------

    def submit(
        self,
        *,
        task_text: str,
        phone_e164: str,
        locale: str,
        region: str,
        recipient_result_schema: dict,
        idempotency_key: str,
        metadata: dict,
    ) -> SubmitResult:
        contact_id = metadata.get("pc_contact_id")
        try:
            ladder_step = int(metadata.get("pc_ladder_step", 0))
        except (TypeError, ValueError):
            ladder_step = 0
        if idempotency_key in self._by_key:
            return SubmitResult.accepted(self._by_key[idempotency_key])

        recording = self.recordings.get((str(contact_id), ladder_step))
        if recording is None:
            return SubmitResult.rejected(
                f"no recorded payload for contact {contact_id!r} at ladder step {ladder_step}",
                "not_found",
            )

        payload = copy.deepcopy(recording)
        call_id = str(payload.get("id") or f"call_replay_{contact_id}_{ladder_step}")
        payload["id"] = call_id
        # Echo the binding the way the live API does, so the intake worker's checks run.
        payload["metadata"] = {**(payload.get("metadata") or {}), **metadata}
        self._by_call_id[call_id] = payload
        self._by_key[idempotency_key] = call_id
        return SubmitResult.accepted(call_id)

    def read(self, call_id: str) -> CallSnapshot:
        payload = self._by_call_id.get(call_id)
        if payload is None:
            raise RecordingError(f"replay transport has no call {call_id}")
        return parse_call_task(payload)

    def raw_payload(self, call_id: str) -> dict:
        payload = self._by_call_id.get(call_id)
        if payload is None:
            raise RecordingError(f"replay transport has no call {call_id}")
        return copy.deepcopy(payload)
