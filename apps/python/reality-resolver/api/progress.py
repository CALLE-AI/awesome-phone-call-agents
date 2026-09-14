"""Publishes a running resolution's progress into a ResolutionStore.

pipeline.resolve() already notifies an Observer at each stage - that is
how resolver.py streams to a terminal. This is the same contract with a
different destination: instead of printing, each hook writes the piece of
the public payload that has just become true.

Nothing here decides anything. Every value published is either handed in
by the hook or projected by api/serialize.py; no rule is scored, no
compliance is evaluated, no verdict is derived. The observer is a
translator between an event and a field, and if it ever needed to compute
something to fill a field, that would mean the field does not exist yet.

The states it writes are `running` and `completed`, and only those.
`queued` belongs to whoever creates the entry, before any of this runs;
`failed` belongs to whoever catches the exception, after it stops. Those
are transport facts about a job, and this class does not own the job.

Not defined here, on purpose: on_api_key. The base class's no-op is
inherited, so the credential pipeline.resolve() passes to that hook
reaches no code in this module and cannot reach the store. The safety
comes from the absence of a method, not from a method that is careful -
see tests/test_progress.py, which asserts the absence.
"""

from __future__ import annotations

from typing import Any

from api.serialize import (
    call_decision_label,
    call_projection,
    case_summary,
    compliance_payload,
    evidence_item,
    reasoning_payload,
    verdict_payload,
)
from api.store import ResolutionNotFoundError, ResolutionStore
from client import sanitize_provider_error_message
from compliance.models import PreCallDecision
from evidence.engine import ReasoningResult
from evidence.model import Case
from pipeline import Observer
from verdict import Verdict

_SAFE_PROVIDER_STATUSES = frozenset({"queued", "in_progress", "completed", "failed", "canceled"})


class StoreObserver(Observer):
    """One per resolution, used by the one thread running it.

    That confinement is why nothing here is locked: the accumulator
    below is only ever touched by the thread inside resolve(). The store
    it writes to is shared, and does its own locking.

    The accumulator exists because two fields arrive in pieces. A
    compliance payload needs the unfiltered decision, the applicable
    subset and the exempted names together, and those come from two
    different hooks - with a third, on_blocked, adding the next legal
    window afterwards. Holding them is not deciding anything; it is
    waiting until there is enough to project.
    """

    def __init__(self, store: ResolutionStore, resolution_id: str) -> None:
        self._store = store
        self._id = resolution_id
        self._decision: PreCallDecision | None = None
        self._applicable: PreCallDecision | None = None
        self._exempted: tuple[str, ...] = ()
        self._next_legal_window: str | None = None
        # Provider diagnostics stay in this worker-local accumulator. They
        # are never part of the public resolution projection.
        self._phase = "preflight"
        self._call_id_present = False
        self._last_provider_status: str | None = None

    @staticmethod
    def _safe_provider_status(value: Any) -> str | None:
        if value is None:
            return None
        text = sanitize_provider_error_message(value)
        if text in _SAFE_PROVIDER_STATUSES:
            return text
        return "unknown"

    def diagnostics(self) -> dict[str, Any]:
        """Return provider-safe worker diagnostics for local logging only."""
        result: dict[str, Any] = {
            "phase": self._phase,
            "call_id_present": self._call_id_present,
        }
        if self._last_provider_status is not None:
            result["last_provider_status"] = self._last_provider_status
        return result

    def _publish(self, patch: dict[str, Any]) -> None:
        """Best-effort. The store is a volatile projection; the pipeline
        is the source of truth.

        An entry can be evicted while its resolution is still running -
        the store is bounded and FIFO, and updating does not refresh an
        entry's position. Losing the projection is a publication problem,
        not a reason to abort the work, and letting it propagate would do
        exactly that: pipeline.resolve() wraps no observer call, so an
        exception raised here kills the resolution mid-flight.

        Only that one exception is swallowed. Anything else raised in
        here is a real fault in this class, and hiding it would turn a
        bug into silence.
        """
        try:
            self._store.update(self._id, patch)
        except ResolutionNotFoundError:
            return

    def _publish_compliance(self) -> None:
        self._publish(
            {
                "compliance": compliance_payload(
                    self._decision, self._applicable, self._exempted, self._next_legal_window
                )
            }
        )

    # --- hooks --------------------------------------------------------

    def on_call_preview(self, preview: dict[str, Any]) -> None:
        # The preview is emitted immediately before the provider client is
        # constructed and POST /v1/calls begins. Do not retain its contents.
        self._phase = "create"

    def on_start(self, case: Case, mode: str) -> None:
        self._publish(
            {
                "state": "running",
                # The seed owns HTTP execution mode (fake/live). The
                # pipeline's EXECUTE/DRY-RUN label belongs to the CLI.
                "case": case_summary(case),
                "evidence": [evidence_item(item) for item in case.evidence.items],
            }
        )

    def on_reasoning(self, reasoning: ReasoningResult) -> None:
        self._publish(
            {
                "reasoning": reasoning_payload(reasoning),
                "call_decision": call_decision_label(reasoning),
            }
        )

    def on_compliance_checks(self, decision: PreCallDecision) -> None:
        # Held, not published: compliance_payload needs the applicable
        # subset too, and that arrives from the next hook.
        self._decision = decision

    def on_use_case_filter(
        self, applicable: PreCallDecision, exempted_checks: tuple[str, ...], use_case: str
    ) -> None:
        self._applicable = applicable
        self._exempted = exempted_checks
        self._publish_compliance()

    def on_blocked(self, window: str) -> None:
        self._next_legal_window = window
        self._publish_compliance()

    def on_call_created(self, call_id: str, status: Any) -> None:
        # call_id is the provider's own identifier and is deliberately
        # unused: it is not a fact about the decision, and it is on the
        # list of things a client never sees. What matters here is that
        # a call now exists, which is what makes "calling" true.
        self._phase = "poll"
        self._call_id_present = True
        self._last_provider_status = self._safe_provider_status(status)
        self._publish({"call": call_projection({"status": status}, placed=True)})

    def on_poll(self, call: dict[str, Any]) -> None:
        self._phase = "poll"
        self._last_provider_status = self._safe_provider_status(call.get("status"))
        self._publish({"call": call_projection(call, placed=True)})

    def on_call_completed(self, call: dict[str, Any]) -> None:
        self._publish({"call": call_projection(call, placed=True)})

    def on_verdict(self, verdict: Verdict) -> None:
        self._publish({"verdict": verdict_payload(verdict), "state": "completed"})

    # on_call_preview is not implemented: the preview is the real request
    # body, carrying the recipient in the clear and the hardened task that
    # embeds the case's call_task_hint. There is nothing in it a client
    # may see, so nothing is taken from it.
    #
    # on_dry_run and on_poll_warning are not implemented either: neither
    # corresponds to a field of the public payload, and inventing one to
    # have somewhere to put them is exactly what this module must not do.
