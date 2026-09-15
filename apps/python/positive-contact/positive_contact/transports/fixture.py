"""Fixture transport: scripted outcomes, no network, default everywhere.

Each file in `fixtures/scenarios/` scripts one contact's whole ladder. A step's `response`
is a full CALL-E `CallTask` object in the shape the OpenAPI publishes, so the adjudicator
under test sees the same field names it will see in production.

The transport echoes back what was submitted, exactly as the real API does: the call id it
issued, the caller-owned `metadata`, and the phone that was dialled. That is what lets the
intake worker's binding checks be exercised offline instead of only in live mode.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from .base import CallSnapshot, SubmitResult, TransportError, parse_call_task


class ScenarioError(TransportError):
    """Raised when a scenario file cannot be used to script a call."""


def load_scenarios(directory: Path | str) -> dict[tuple[str, int], dict]:
    """Index every scripted step by `(contact_id, ladder_step)`."""
    root = Path(directory)
    if not root.is_dir():
        raise ScenarioError(f"no scenario directory at {root}")
    index: dict[tuple[str, int], dict] = {}
    for path in sorted(root.glob("*.json")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ScenarioError(f"could not read scenario {path.name}: {exc}") from exc
        contact_id = document.get("contact_id")
        if not contact_id:
            raise ScenarioError(f"scenario {path.name} has no contact_id")
        for step in document.get("steps", []):
            try:
                key = (contact_id, int(step["ladder_step"]))
            except (KeyError, TypeError, ValueError) as exc:
                raise ScenarioError(
                    f"scenario {path.name} has a step without a usable ladder_step"
                ) from exc
            if key in index:
                raise ScenarioError(
                    f"scenario {path.name} redefines {contact_id} step {key[1]}"
                )
            index[key] = {**step, "scenario": document.get("scenario", path.stem)}
    if not index:
        raise ScenarioError(f"no scripted steps found in {root}")
    return index


class FixtureTransport:
    """Deterministic transport driven by `fixtures/scenarios/*.json`."""

    def __init__(self, scenario_dir: Path | str) -> None:
        self.scenarios = load_scenarios(scenario_dir)
        self._by_call_id: dict[str, dict] = {}
        self._by_key: dict[str, str] = {}
        self.submitted_payloads: list[dict] = []

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

        # Replaying a key returns the original call, exactly as the contract describes.
        if idempotency_key in self._by_key:
            return SubmitResult.accepted(self._by_key[idempotency_key])

        step = self.scenarios.get((contact_id, ladder_step))
        if step is None:
            raise ScenarioError(
                f"no scripted outcome for contact {contact_id!r} at ladder step {ladder_step}"
            )

        self.submitted_payloads.append(
            {
                "task_text": task_text,
                "phone_e164": phone_e164,
                "locale": locale,
                "region": region,
                "idempotency_key": idempotency_key,
                "metadata": dict(metadata),
                "recipient_result_schema": recipient_result_schema,
            }
        )

        outcome = step.get("submit", "accepted")
        if outcome == "unknown":
            # The call may or may not have been placed. Deliberately no call id.
            return SubmitResult.unknown(
                step.get("reason", "provider did not confirm the submission"),
                step.get("error_code"),
            )
        if outcome == "rejected":
            return SubmitResult.rejected(
                step.get("reason", "provider rejected the submission"),
                step.get("error_code"),
            )

        call_id = step.get("call_id") or f"call_fx_{contact_id}_{ladder_step}"
        response = copy.deepcopy(step.get("response") or {})
        response["id"] = call_id
        response["metadata"] = dict(metadata)
        recipients = response.get("recipients") or []
        if recipients and isinstance(recipients[0], dict):
            recipients[0]["phones"] = [phone_e164]
            recipients[0].setdefault("locale", locale)
            recipients[0].setdefault("region", region)
        for attempt in (recipients[0].get("attempts") if recipients else None) or []:
            if isinstance(attempt, dict):
                attempt["phone"] = phone_e164
        self._by_call_id[call_id] = response
        self._by_key[idempotency_key] = call_id
        return SubmitResult.accepted(call_id)

    def read(self, call_id: str) -> CallSnapshot:
        payload = self._by_call_id.get(call_id)
        if payload is None:
            raise ScenarioError(f"fixture transport has no call {call_id}")
        return parse_call_task(payload)

    # -- helpers used by the runner ---------------------------------------------

    def raw_payload(self, call_id: str) -> dict:
        payload = self._by_call_id.get(call_id)
        if payload is None:
            raise ScenarioError(f"fixture transport has no call {call_id}")
        return copy.deepcopy(payload)

    def has_step(self, contact_id: str, ladder_step: int) -> bool:
        return (contact_id, ladder_step) in self.scenarios
