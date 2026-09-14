"""Structured, PII-free JSON observability for one run.

Everything this module emits is a JSON object with a fixed, typed field
allowlist. Two rules make the stream safe to log anywhere:

1. **Field names are closed.** An event may carry only the fields below;
   anything else a caller tries to attach is dropped and counted, never
   written.
2. **Vocabulary fields are closed.** ``gate``, ``refusal``, ``state``,
   ``from_state``, ``to_state`` and ``terminal_state`` must be members of
   the implementation's own enums (rendered as their values). Free text
   cannot enter the log through them, so a phone number or a transcript
   fragment has no route into an event.

The one deliberately free-form field is ``note``, used for short fixed
sentences this module itself composes — never caller prose.

A run gets one ``correlation_id`` (random, generated here, carried on every
event) so a log stream can be sliced by run without carrying any business
identity. Receipts and proof artifacts never read the event log, so their
determinism is untouched: observability is a diagnostic surface, not a
proof surface.

The event log also backs two operator views:

* ``metrics()`` — the counters a release gate or dashboard reads:
  events emitted, refusals by gate, terminal states, transitions;
* ``pane()`` — the audit pane the review screen renders, which is the same
  event stream, newest last, as plain dictionaries.
"""

from __future__ import annotations

import json
import re
import sys
import uuid
from typing import Any, Callable, Optional

from .authorization import AuthorizationRefusal
from .disclosure import TaskTextRefusal
from .envelope import EnvelopeRefusal
from .gates import EconomicRefusal, ResidualRefusal, VersionRefusal
from .ledger import LedgerRefusal
from .writeback import WriteBackOutcome, WriteBackRefusal

#: Event names this module may emit. Closed on purpose.
EVENT_NAMES = frozenset(
    {
        "run_started",
        "gate_passed",
        "gate_refused",
        "reserved",
        "duplicate_suppressed",
        "call_created",
        "transport_terminal",
        "outcome_derived",
        "review_prepared",
        "decision_recorded",
        "write_back_result",
        "recovery_started",
        "recovery_result",
        "field_dropped_from_event",
    }
)

#: The complete field allowlist. Anything outside this set is dropped.
ALLOWED_FIELDS = frozenset(
    {
        "ts",
        "correlation_id",
        "event",
        "gate",
        "refusals",
        "refusal",
        "state",
        "from_state",
        "to_state",
        "terminal_state",
        "actor",
        "note",
        "key_prefix",
        "provider",
        "decision",
        "outcome",
    }
)

#: Fields whose values must come from a closed vocabulary. The vocabularies
#: are the implementation's own enums — the log can never say something the
#: code cannot say.
_VOCABULARIES: dict[str, frozenset[str]] = {}


def _vocabularies() -> dict[str, frozenset[str]]:
    """Build (once) the per-field legal value sets from the live enums."""

    global _VOCABULARIES
    if not _VOCABULARIES:
        # Imported here, not at module level: workflow imports EventLog from
        # this module, so a top-level import of RefusalGate would be circular.
        from .workflow import RefusalGate

        gate_refusals: set[str] = set()
        for enum in (
            EnvelopeRefusal,
            ResidualRefusal,
            VersionRefusal,
            EconomicRefusal,
            AuthorizationRefusal,
            TaskTextRefusal,
            LedgerRefusal,
        ):
            gate_refusals.update(item.value for item in enum)
        write_results: set[str] = {item.value for item in WriteBackRefusal}
        write_results.update(item.value for item in WriteBackOutcome)
        _VOCABULARIES = {
            "gate": frozenset(item.value for item in RefusalGate),
            "refusal": frozenset(gate_refusals),
            "refusals": frozenset(gate_refusals),
            "state": frozenset(
                {"RESERVED", "COMPLETED", "UNKNOWN", "NOT_ATTEMPTED"}
            ),
            "from_state": frozenset({"RESERVED", "COMPLETED", "UNKNOWN"}),
            "to_state": frozenset({"RESERVED", "COMPLETED", "UNKNOWN"}),
            "terminal_state": frozenset(
                {
                    "NOT_ATTEMPTED",
                    "IN_FLIGHT",
                    "TRANSPORT_FAILED",
                    "RESULT_UNAVAILABLE",
                    "RESULT_INVALID",
                    "INFORMATION_OBTAINED",
                    "ACTION_REQUIRED",
                    "BUSINESS_UNRESOLVED",
                    "MENU_UNRESOLVED",
                }
            ),
            "decision": frozenset({"APPROVE", "REFUSE", "RETURN_TO_DIGITAL"}),
            "outcome": frozenset(write_results),
            "actor": frozenset(
                {"workflow", "provider", "reviewer", "operator", "recovery"}
            ),
        }
    return _VOCABULARIES


#: ``key_prefix`` — a hex digest prefix, optionally behind its namespace slug
#: (``warrantyops:17e824e3d626`` or ``17e824e3d626``). The hex part is at
#: most 16 characters; the slug at most 16 of ``[a-z0-9-]``.
_KEY_PREFIX_RE = re.compile(r"[a-z0-9-]{0,16}:?[0-9a-f]{1,16}")


def _looks_like_sensitive(value: str) -> bool:
    """The backstop: even an allowlisted field never carries digit runs.

    A legal vocabulary value never contains a long digit run. If one shows
    up, the value did not come from a vocabulary — drop the field.
    """

    digits = 0
    for char in value:
        if char.isdigit():
            digits += 1
            if digits >= 5:
                return True
        else:
            digits = 0
    return False


class EventLog:
    """One run's structured event stream plus its counters.

    ``sink``, when supplied, receives each emitted event as a JSON line
    (the default sink writes to stderr). Pass a list-appending callable in
    tests to capture the stream without touching stderr.
    """

    def __init__(
        self,
        sink: Optional[Callable[[str], None]] = None,
        correlation_id: Optional[str] = None,
    ) -> None:
        self.correlation_id = correlation_id or uuid.uuid4().hex[:16]
        self._sink = sink if sink is not None else _stderr_sink
        self._events: list[dict[str, Any]] = []
        self._dropped_fields = 0
        self._counters: dict[str, dict[str, int]] = {
            "events": {},
            "refusals_by_gate": {},
            "terminal_states": {},
            "transitions": {},
        }

    # -- emission ---------------------------------------------------------

    def emit(self, event: str, **fields: object) -> None:
        """Emit one event. Unknown names and fields are dropped, counted."""

        body: dict[str, object] = {"event": event, "correlation_id": self.correlation_id}
        if event not in EVENT_NAMES:
            self._dropped_fields += 1
            self._count_event("field_dropped_from_event")
            return
        vocab = _vocabularies()
        for name, value in fields.items():
            if name not in ALLOWED_FIELDS:
                self._dropped_fields += 1
                continue
            if name in vocab:
                legal = vocab[name]
                if isinstance(value, (list, tuple)):
                    if not all(isinstance(v, str) and v in legal for v in value):
                        self._dropped_fields += 1
                        continue
                elif not (isinstance(value, str) and value in legal):
                    self._dropped_fields += 1
                    continue
            elif name == "key_prefix":
                # A digest prefix is hex by construction — optionally behind
                # its namespace slug, since derived keys read
                # ``namespace:digest``. Anything else is not a digest prefix
                # and is dropped.
                if not (
                    isinstance(value, str)
                    and 0 < len(value) <= 28
                    and _KEY_PREFIX_RE.fullmatch(value) is not None
                ):
                    self._dropped_fields += 1
                    continue
            elif name == "ts":
                if not isinstance(value, str):
                    self._dropped_fields += 1
                    continue
            elif isinstance(value, str) and _looks_like_sensitive(value):
                # The remaining free fields (``note``, ``provider``) never
                # carry digit runs; this is the planted-value negative
                # control's tripwire.
                self._dropped_fields += 1
                continue
            body[name] = value
        self._events.append(body)
        self._count_event(event)
        self._count_field_values(event, body)
        self._sink(json.dumps(body, sort_keys=True, separators=(",", ":")))

    def _count_event(self, event: str) -> None:
        counts = self._counters["events"]
        counts[event] = counts.get(event, 0) + 1

    def _count_field_values(self, event: str, body: dict[str, object]) -> None:
        if event == "gate_refused":
            gate = str(body.get("gate", "UNKNOWN"))
            counts = self._counters["refusals_by_gate"]
            counts[gate] = counts.get(gate, 0) + 1
        if event == "outcome_derived" and "terminal_state" in body:
            state = str(body["terminal_state"])
            counts = self._counters["terminal_states"]
            counts[state] = counts.get(state, 0) + 1
        if event in ("reserved", "call_created") or "to_state" in body:
            transition = f"{body.get('from_state', '∅')}→{body.get('to_state', event)}"
            counts = self._counters["transitions"]
            counts[transition] = counts.get(transition, 0) + 1

    # -- views ------------------------------------------------------------

    def events(self) -> tuple[dict[str, Any], ...]:
        """Every emitted event body, oldest first (the audit pane's data)."""

        return tuple(self._events)

    def dropped_fields(self) -> int:
        """How many non-allowlisted or sensitive fields were refused."""

        return self._dropped_fields

    def metrics(self) -> dict[str, object]:
        """The counters, plus the run identity and drop count."""

        return {
            "correlation_id": self.correlation_id,
            "events_total": len(self._events),
            "dropped_fields": self._dropped_fields,
            "by_event": dict(self._counters["events"]),
            "refusals_by_gate": dict(self._counters["refusals_by_gate"]),
            "terminal_states": dict(self._counters["terminal_states"]),
            "transitions": dict(self._counters["transitions"]),
        }

    def pane(self) -> list[dict[str, Any]]:
        """The operator-facing audit pane: the event stream as rows."""

        return list(self._events)


def _stderr_sink(line: str) -> None:
    print(line, file=sys.stderr)


def json_metrics(log: EventLog) -> str:
    """Canonical JSON rendering of a run's metrics (``--metrics``)."""

    return json.dumps(log.metrics(), sort_keys=True, separators=(",", ":"))
