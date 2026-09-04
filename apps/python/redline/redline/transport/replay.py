"""Replay a recorded CALL-E response instead of placing a call.

This is how real platform behaviour gets pinned into a test suite that runs
with no network and no credits. Record one real call, save the payload, and
every future run evaluates the same bytes -- so a change in REDLINE's verdict
is a change in REDLINE, not weather.

A fixture is either a bare CALL-E payload, or that payload wrapped with the
ground truth an operator attested to at the time::

    {
      "redline_fixture": {
        "version": 1,
        "scenario_id": "voicemail-after-three-rings",
        "recorded_at": "2026-09-06",
        "ground_truth": {
          "disposition": "voicemail",
          "human_confirmed": null,
          "declared_by": "operator"
        },
        "note": "Called a handset we own; it went to voicemail after 4 rings."
      },
      "payload": { "object": "call_task", ... }
    }

The wrapper exists because a real recording has no scripted persona to derive
truth from: somebody watched the call and said what happened. Recording who
made that claim is not bureaucracy -- a report that presents an operator's
account as a measurement is exactly the kind of unverifiable assertion that
gets a submission rejected, and rightly.

Fixtures must be recorded against numbers you own, and must never contain a
real one. ``scripts/scan_secrets.py`` enforces the second part.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from redline.calle.models import call_record_from_payload
from redline.scenario.model import Scenario
from redline.subject import SubjectUnderTest
from redline.transport.base import TransportError
from redline.types import CallRecord, Disposition, GroundTruth

__all__ = ["ReplayTransport"]

FIXTURE_KEY = "redline_fixture"


class ReplayTransport:
    """Replays a recorded payload for each scenario."""

    name = "replay"
    places_real_calls = False

    def __init__(self, fixtures_dir: Path) -> None:
        self.fixtures_dir = fixtures_dir

    def run(
        self,
        subject: SubjectUnderTest,
        scenario: Scenario,
        *,
        idempotency_key: str,
    ) -> CallRecord:
        path = self.fixture_path(scenario)
        if not path.exists():
            raise TransportError(
                f"no fixture for scenario {scenario.id!r}: expected {path}. "
                "Record one with `redline run --transport live --record`, or "
                "use the default static transport."
            )

        document = self._read(path)
        payload, ground_truth = self._split(document, scenario, path)

        record = call_record_from_payload(
            payload,
            scenario_id=scenario.id,
            ground_truth=ground_truth,
            transport=self.name,
        )
        return record

    def fixture_path(self, scenario: Scenario) -> Path:
        return self.fixtures_dir / f"{scenario.id}.json"

    # --- Reading -----------------------------------------------------------

    def _read(self, path: Path) -> Mapping[str, Any]:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except OSError as error:
            raise TransportError(f"{path}: cannot be read: {error}") from error
        except json.JSONDecodeError as error:
            raise TransportError(f"{path}: is not valid JSON: {error}") from error

        if not isinstance(document, Mapping):
            raise TransportError(f"{path}: expected a JSON object")
        return document

    def _split(
        self,
        document: Mapping[str, Any],
        scenario: Scenario,
        path: Path,
    ) -> tuple[Mapping[str, Any], GroundTruth]:
        metadata = document.get(FIXTURE_KEY)
        if metadata is None:
            # A bare payload: the scenario's scripted truth still applies.
            return document, _scenario_truth(scenario)

        if not isinstance(metadata, Mapping):
            raise TransportError(f"{path}: {FIXTURE_KEY!r} must be an object")

        payload = document.get("payload")
        if not isinstance(payload, Mapping):
            raise TransportError(
                f"{path}: a wrapped fixture must carry a 'payload' object"
            )

        recorded_id = metadata.get("scenario_id")
        if recorded_id is not None and recorded_id != scenario.id:
            raise TransportError(
                f"{path}: this fixture was recorded for scenario "
                f"{recorded_id!r}, not {scenario.id!r}"
            )

        return payload, self._ground_truth(metadata, scenario, path)

    def _ground_truth(
        self,
        metadata: Mapping[str, Any],
        scenario: Scenario,
        path: Path,
    ) -> GroundTruth:
        block = metadata.get("ground_truth")
        if not isinstance(block, Mapping):
            return _scenario_truth(scenario)

        raw_disposition = block.get("disposition")
        try:
            disposition = (
                Disposition(raw_disposition)
                if raw_disposition is not None
                else scenario.persona.disposition
            )
        except ValueError as error:
            raise TransportError(
                f"{path}: {raw_disposition!r} is not a known disposition"
            ) from error

        return GroundTruth(
            disposition=disposition,
            human_confirmed=block.get("human_confirmed", scenario.human_confirmed),
            facts=dict(block.get("facts") or scenario.facts),
            # Default to `operator`: a recording had a human watching it, and
            # claiming otherwise would dress an account up as a measurement.
            declared_by=str(block.get("declared_by", "operator")),
        )


def _scenario_truth(scenario: Scenario) -> GroundTruth:
    return GroundTruth(
        disposition=scenario.persona.disposition,
        human_confirmed=scenario.human_confirmed,
        facts=scenario.facts,
        declared_by="scenario",
    )
