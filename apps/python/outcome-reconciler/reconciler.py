"""The reconciliation state machine.

`reconcile()` is a pure function of (observations, mapping table, policy
signals). It performs no I/O and reads no clock — both are injected by the
poller. That is what makes it testable against fixtures with zero credentials,
and what makes it idempotent: the same observations always produce the same
record.

Evaluation order, once a payload-bearing observation exists:

1. structural checks      -> malformed_payload
2. consistency guards     -> the guard's reason (guards fire before mapping)
3. documented entries     -> a semantic outcome, traced by entry id
4. unmappable values      -> the unmappable item's reason
5. anything else          -> undocumented_code

The layer never converts an unknown into a semantic outcome.
"""

from __future__ import annotations

from typing import Mapping, Sequence

from mapping import OutcomeMap
from record import Evidence, MappingTrace, Observation, OutcomeRecord

DEFAULT_EXHAUSTION_REASON = "polling_budget_exhausted"


def _unresolved(
    call_ref: str,
    reason: str,
    observations: Sequence[Observation],
    evidence: Evidence,
    outcome_map: OutcomeMap,
    recipient_phone: str | None,
    surface: str | None = None,
) -> OutcomeRecord:
    return OutcomeRecord(
        call_ref=call_ref,
        outcome="unresolved",
        reason=reason,
        mapping=MappingTrace(
            matched=False,
            entry_id=None,
            map_version=outcome_map.map_version,
            surface=surface,
        ),
        evidence=evidence,
        observations=list(observations),
        recipient_phone=recipient_phone,
    )


def _describe(outcome_map: OutcomeMap, observation: Observation) -> str:
    if observation.transport_error:
        return f"{observation.surface}:<transport_error>"
    payload = observation.payload or {}
    value = outcome_map.status_value(observation.surface, payload)
    return f"{observation.surface}:{value if value else '<no status field>'}"


def _sole_recipient_phone(observations: Sequence[Observation]) -> str | None:
    """The recipient's number, when the payload names exactly one.

    Reading, not inferring: the number is already in the payload. A record that
    says "unknown recipient" while carrying the number in `raw` is just hiding
    what it has. Deliberately gives up on a batch call — masking one number out
    of several would label the record with a recipient it is not about.
    """
    for observation in reversed(list(observations)):
        recipients = (observation.payload or {}).get("recipients")
        if not isinstance(recipients, list) or len(recipients) != 1:
            continue
        first = recipients[0]
        phones = first.get("phones") if isinstance(first, Mapping) else None
        if isinstance(phones, list) and len(phones) == 1 and isinstance(phones[0], str):
            return phones[0]
    return None


def reconcile(
    call_ref: str,
    observations: Sequence[Observation],
    outcome_map: OutcomeMap,
    *,
    recipient_phone: str | None = None,
    exhausted: bool = False,
    exhaustion_reason: str | None = None,
) -> OutcomeRecord:
    """Reduce a sequence of observations to exactly one terminal outcome."""
    evidence = Evidence()
    observations = list(observations)
    recipient_phone = recipient_phone or _sole_recipient_phone(observations)

    for observation in observations:
        evidence.observed_states.append(_describe(outcome_map, observation))
        if observation.transport_error:
            evidence.notes.append(
                f"transport error during polling: {observation.transport_error}"
            )

    if not observations:
        evidence.decision.append("no observations were supplied")
        return _unresolved(
            call_ref, "no_observations", observations, evidence, outcome_map, recipient_phone
        )

    payload_bearing = [o for o in observations if o.payload is not None]
    if not payload_bearing:
        reason = exhaustion_reason or DEFAULT_EXHAUSTION_REASON
        evidence.decision.append(
            "every observation was a transport error; no upstream payload was ever read"
        )
        evidence.notes.append("transport errors alone never produce a semantic outcome")
        return _unresolved(
            call_ref, reason, observations, evidence, outcome_map, recipient_phone
        )

    last = payload_bearing[-1]
    surface = last.surface
    payload: Mapping[str, object] = last.payload or {}
    evidence.decision.append(f"evaluated the last payload observed on surface {surface}")

    if not outcome_map.knows_surface(surface):
        evidence.decision.append(f"surface {surface} is not declared in the mapping table")
        return _unresolved(
            call_ref, "undocumented_code", observations, evidence, outcome_map,
            recipient_phone, surface,
        )

    if not isinstance(payload, Mapping):
        evidence.decision.append("payload is not a mapping")
        return _unresolved(
            call_ref, "malformed_payload", observations, evidence, outcome_map,
            recipient_phone, surface,
        )

    declared = outcome_map.surfaces[surface]
    status_value = outcome_map.status_value(surface, payload)
    if status_value is None:
        evidence.decision.append(
            f"payload has no usable {declared.status_field!r} field on surface {surface}"
        )
        return _unresolved(
            call_ref, "malformed_payload", observations, evidence, outcome_map,
            recipient_phone, surface,
        )

    guard = outcome_map.failing_guard(surface, payload)
    if guard is not None:
        evidence.decision.append(f"consistency guard {guard.id} fired before mapping")
        if guard.note:
            evidence.notes.append(guard.note)
        if guard.issue_ref:
            evidence.notes.append(f"see upstream issue #{guard.issue_ref}")
        return _unresolved(
            call_ref, guard.reason, observations, evidence, outcome_map,
            recipient_phone, surface,
        )

    if not outcome_map.is_terminal(surface, payload):
        reason = exhaustion_reason or DEFAULT_EXHAUSTION_REASON
        evidence.decision.append(
            f"status {status_value!r} is not terminal on surface {surface}; "
            f"polling ended without a terminal state"
        )
        if not exhausted and exhaustion_reason is None:
            evidence.notes.append("polling stopped before a terminal state was observed")
        return _unresolved(
            call_ref, reason, observations, evidence, outcome_map, recipient_phone, surface
        )

    entry = outcome_map.lookup(surface, payload)
    if entry is not None:
        evidence.decision.append(
            f"matched documented entry {entry.id} -> {entry.outcome} (source: {entry.source})"
        )
        return OutcomeRecord(
            call_ref=call_ref,
            outcome=entry.outcome,
            reason=None,
            mapping=MappingTrace(
                matched=True,
                entry_id=entry.id,
                map_version=outcome_map.map_version,
                surface=surface,
            ),
            evidence=evidence,
            observations=observations,
            recipient_phone=recipient_phone,
        )

    unmappable = outcome_map.find_unmappable(surface, payload)
    if unmappable is not None:
        evidence.decision.append(
            f"matched unmappable value {unmappable.id}; no documented outcome exists"
        )
        if unmappable.note:
            evidence.notes.append(unmappable.note)
        if unmappable.issue_ref:
            evidence.notes.append(f"see upstream issue #{unmappable.issue_ref}")
        return _unresolved(
            call_ref, unmappable.reason, observations, evidence, outcome_map,
            recipient_phone, surface,
        )

    evidence.decision.append(
        f"no documented mapping entry matched status {status_value!r} on surface {surface}"
    )
    evidence.notes.append("raw payload preserved verbatim; no outcome was inferred")
    return _unresolved(
        call_ref, "undocumented_code", observations, evidence, outcome_map,
        recipient_phone, surface,
    )
