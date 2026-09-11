"""Orchestration for Reality Resolver, shared by every interface.

resolver.py is the CLI: argparse in, printing out. This module holds the
pipeline it runs, so that the ordering carrying this app's safety
properties exists in exactly one place instead of once per interface:

  live/now-utc interlock -> load case -> exact-destination authorization
  -> evidence matrix -> R1-R4 -> decision-critical? -> compliance gate
  -> use-case applicability -> hard gate -> next legal window
  -> hardened task -> dry-run boundary -> CALL-E -> reconciliation
  -> verdict

Nothing here prints, and nothing here decides anything the engine did
not already decide: evidence/, compliance/, client.py and verdict.py are
called exactly as resolver.py called them, in the same order, with the
same arguments. A caller that wants the CLI's incremental output passes
an Observer whose hooks fire at each stage - the same callback shape
client.py's poll_until_terminal already uses for on_poll/on_warn.

Failures are raised, never printed or swallowed, so each interface
renders them its own way. Only the two pre-flight refusals get a
dedicated type (ResolutionRefused); everything else propagates as
whatever the underlying layer already raised.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any

from client import (
    CallEClient,
    build_hardened_task,
    build_recipient,
    derive_idempotency_key,
    mask_phone,
    render_disclosure_script,
    resolve_api_key,
)
from compliance.dispatcher import resolve_locale_and_region, run_precall_checks
from compliance.models import PreCallContext, PreCallDecision
from compliance.use_cases import apply_use_case
from evidence.engine import ReasoningResult, evaluate
from evidence.model import Case, load_case
from next_window import next_legal_window
from verdict import (
    ACTION_NO_ACTION_REQUIRED,
    ACTION_RETRY_WHEN_PERMITTED,
    Verdict,
    reconcile,
    subject_intent_result_schema,
)


class ResolutionRefused(Exception):
    """A pre-flight refusal: the run stopped before the evidence engine,
    because a safety precondition was not met. Carries the exact operator
    message; the interface decides where to print it.
    """


@dataclass(frozen=True)
class ResolutionRequest:
    """Everything the pipeline needs, with no argparse dependency.

    base_url/execute/allow_live are named exactly as client.py's
    resolve_api_key() reads them, so this object can be handed to it
    directly - that function is duck-typed on those three attributes and
    stays unmodified.
    """

    case_path: str
    base_url: str
    execute: bool = False
    allow_live: bool = False
    authorize_destination: str | None = None
    phone_override: str | None = None
    now_utc: datetime | None = None
    poll_interval_seconds: float = 2.0
    poll_timeout_seconds: float | None = None
    poll_warn_after_seconds: float | None = 300.0
    # Compliance context - operator-attested at call time, never case data.
    intends_to_record: bool = False
    consent_obtained: bool = False
    consent_timestamp: datetime | None = None
    dnc_checked: bool = False
    gdpr_basis_documented: bool = False
    recipient_timezone: str | None = None
    solicitations_in_last_24h: int | None = None
    entity_name: str | None = None
    agent_name: str | None = None


@dataclass(frozen=True)
class Resolution:
    """What one run produced, stage by stage.

    `call` holds CALL-E's response exactly as returned - not a redacted
    or sanitized copy. Redaction is a rendering concern and belongs to
    whoever displays this, for the same reason verdict.reconcile() is
    given the raw structured_result: the engine must reason about what
    the provider actually said.
    """

    case: Case
    mode: str  # "EXECUTE" | "DRY-RUN"
    reasoning: ReasoningResult
    compliance: PreCallDecision | None = None
    applicable_compliance: PreCallDecision | None = None
    exempted_checks: tuple[str, ...] = ()
    next_legal_window: str | None = None
    call_preview: dict[str, Any] | None = None
    call_placed: bool = False
    call: dict[str, Any] | None = None
    # None only on the dry-run path, which stops before a call and so
    # has nothing to reconcile - matching the CLI, which prints no
    # verdict there.
    verdict: Verdict | None = None


class Observer:
    """No-op hooks, one per point where the CLI prints something.

    Subclass and override what you need; anything not overridden costs a
    function call and nothing else. Each hook exists because resolver.py
    printed there before this module existed - that one-to-one mapping is
    what makes the extraction auditable.
    """

    def on_start(self, case: Case, mode: str) -> None: ...

    def on_reasoning(self, reasoning: ReasoningResult) -> None: ...

    # Split in two, and fired either side of the use-case filter, because
    # that is where resolver.py printed: the raw check list goes out
    # before apply_use_case() runs, so an unmapped use_case still shows
    # the operator what the gate found before it refuses.
    def on_compliance_checks(self, decision: PreCallDecision) -> None: ...

    def on_use_case_filter(
        self,
        applicable: PreCallDecision,
        exempted_checks: tuple[str, ...],
        use_case: str,
    ) -> None: ...

    def on_blocked(self, window: str) -> None: ...

    def on_call_preview(self, preview: dict[str, Any]) -> None: ...

    def on_dry_run(self) -> None: ...

    def on_api_key(self, api_key: str) -> None: ...

    def on_call_created(self, call_id: str, status: Any) -> None: ...

    def on_poll(self, call: dict[str, Any]) -> None: ...

    def on_poll_warning(self, minutes_elapsed: float, call: dict[str, Any]) -> None: ...

    def on_call_completed(self, call: dict[str, Any]) -> None: ...

    def on_verdict(self, verdict: Verdict) -> None: ...


_NO_OP_OBSERVER = Observer()


def evidence_citations(case: Case) -> tuple[str, ...]:
    return tuple(f"{item.source}: {item.claim!r}" for item in case.evidence.items)


def _check_preconditions(request: ResolutionRequest) -> None:
    """The live/now-utc interlock, checked before anything is loaded or
    run: a real call must always be evaluated against the real current
    time. allow_live only ever means "a real call to CALL-E is explicitly
    authorized" - execute is still required as a second, separate
    confirmation before anything is ever sent.
    """
    if request.allow_live and request.now_utc is not None:
        raise ResolutionRefused(
            "error: --now-utc cannot be combined with --allow-live. A real call must always be "
            "evaluated against the real current time, never an overridden one."
        )


def _authorize_destination(request: ResolutionRequest, case: Case) -> None:
    """Checked here because this is the first point where the final
    number is known: phone_override has already replaced the case file's
    call_phone, so case.call_phone from here on is exactly the string
    build_recipient() will put in the request body. Comparison is
    byte-exact and deliberately does no normalization - no stripping, no
    reformatting, no country-code inference - so a number that merely
    looks equivalent can never authorize a different one. allow_live
    alone declares intent to place a real call; it does not say which
    number that call may reach, and this is what makes that explicit.
    Refused before the evidence engine runs and long before any client is
    constructed, so nothing can reach the network.
    """
    if not request.allow_live or request.authorize_destination == case.call_phone:
        return
    if request.authorize_destination is None:
        raise ResolutionRefused(
            "error: --allow-live requires --authorize-destination <E.164> naming the exact "
            "number this call may reach. Nothing was sent."
        )
    raise ResolutionRefused(
        "error: --authorize-destination does not match the call's resolved destination "
        f"({mask_phone(request.authorize_destination)} authorized, "
        f"{mask_phone(case.call_phone)} would be called). The authorized number must "
        "match exactly, with no reformatting. Nothing was sent."
    )


def resolve(request: ResolutionRequest, observer: Observer | None = None) -> Resolution:
    """Run one case end to end and return what happened at every stage.

    Raises ResolutionRefused for a pre-flight refusal, and otherwise lets
    the underlying layers raise: UnknownUseCaseError from the use-case
    filter, CallEAPIError/RuntimeError/TimeoutError from the client, and
    KeyboardInterrupt straight through while polling.
    """
    observer = observer or _NO_OP_OBSERVER

    _check_preconditions(request)

    case = load_case(request.case_path)
    if request.phone_override:
        case = replace(case, call_phone=request.phone_override)

    _authorize_destination(request, case)

    now = request.now_utc or datetime.now(timezone.utc)
    mode = "EXECUTE" if request.execute else "DRY-RUN"
    observer.on_start(case, mode)

    reasoning = evaluate(case.evidence, case.deadline, now, case.decision_deadline_threshold)
    observer.on_reasoning(reasoning)

    citations = evidence_citations(case)

    if not reasoning.decision_critical:
        verdict = Verdict("NO_CALL_NEEDED", ACTION_NO_ACTION_REQUIRED, citations)
        observer.on_verdict(verdict)
        return Resolution(case=case, mode=mode, reasoning=reasoning, verdict=verdict)

    context = PreCallContext(
        phone_e164=case.call_phone,
        intends_to_record=request.intends_to_record,
        consent_obtained=request.consent_obtained,
        consent_timestamp=request.consent_timestamp,
        dnc_checked=request.dnc_checked,
        gdpr_basis_documented=request.gdpr_basis_documented,
        recipient_timezone=request.recipient_timezone,
        now_utc=now,
        solicitations_in_last_24h=request.solicitations_in_last_24h,
    )
    decision: PreCallDecision = run_precall_checks(context)
    observer.on_compliance_checks(decision)

    applicable_decision = apply_use_case(decision, case.use_case)
    exempted_checks = tuple(
        result.check_name for result in decision.results if result not in applicable_decision.results
    )
    observer.on_use_case_filter(applicable_decision, exempted_checks, case.use_case)

    use_case_citation = f"use_case={case.use_case}"
    partial = Resolution(
        case=case,
        mode=mode,
        reasoning=reasoning,
        compliance=decision,
        applicable_compliance=applicable_decision,
        exempted_checks=exempted_checks,
    )

    if not applicable_decision.allowed:
        # Fully enforced, fail-closed - the hard gate always applies, for
        # every case and every target, real or fake. There is no mode
        # that bypasses or merely warns about a failing check still
        # applicable to this use case.
        window = next_legal_window(applicable_decision, request.recipient_timezone, now)
        observer.on_blocked(window)
        verdict = Verdict(
            "UNRESOLVED_CALL_BLOCKED",
            ACTION_RETRY_WHEN_PERMITTED,
            citations
            + (
                f"compliance gate blocked: {applicable_decision.blocking_reasons}",
                f"next legal window: {window}",
                use_case_citation,
            ),
        )
        observer.on_verdict(verdict)
        return replace(partial, next_legal_window=window, verdict=verdict)

    locale, region, disclosure_script_template = resolve_locale_and_region(decision.jurisdiction_chain)
    disclosure_script = (
        render_disclosure_script(disclosure_script_template, request.entity_name, request.agent_name)
        if disclosure_script_template
        else None
    )
    hardened_task = build_hardened_task(case.call_task_hint, disclosure_script=disclosure_script)
    recipient = build_recipient(case.call_phone, locale, region)
    result_schema = subject_intent_result_schema()

    call_preview = {
        "task": hardened_task,
        "recipients": [recipient],
        "result_schema": result_schema,
    }
    observer.on_call_preview(call_preview)
    partial = replace(partial, call_preview=call_preview)

    if not request.execute:
        observer.on_dry_run()
        return partial

    api_key = resolve_api_key(request)
    observer.on_api_key(api_key)

    client = CallEClient(base_url=request.base_url, api_key=api_key, allow_live=request.allow_live)
    idempotency_key = derive_idempotency_key(case.call_phone, case.call_task_hint, datetime.now(timezone.utc))

    created = client.create_call(
        task=hardened_task,
        recipients=[recipient],
        result_schema=result_schema,
        idempotency_key=idempotency_key,
    )

    # call_id keeps the provider's raw value - it is what a later
    # GET /v1/calls/{id} must be built from. Sanitizing for display is
    # the observer's job, not this module's.
    call_id = created["id"]
    observer.on_call_created(call_id, created.get("status"))

    final_call = client.poll_until_terminal(
        call_id,
        interval_seconds=request.poll_interval_seconds,
        timeout_seconds=request.poll_timeout_seconds,
        warn_after_seconds=request.poll_warn_after_seconds,
        on_poll=observer.on_poll,
        on_warn=observer.on_poll_warning,
    )
    observer.on_call_completed(final_call)

    structured_result = final_call.get("structured_result")
    verdict = reconcile(structured_result, case.decision_options, case.evidence)
    verdict = replace(verdict, evidence_cited=verdict.evidence_cited + (use_case_citation,))
    observer.on_verdict(verdict)

    return replace(
        partial,
        call_placed=True,
        call=final_call,
        verdict=verdict,
    )
