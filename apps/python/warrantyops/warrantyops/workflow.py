"""One authorized residual claim exception, from envelope to terminal outcome.

The order is fixed and every step can refuse: validate the envelope, prove
the call is residual, prove the source has not moved (with a reader, or not
at all), clear the organization's economics, authorize the recipient and
bind that authorization to the claim's counterparty number, derive the
claim-version bound key, build the task from the disclosure allowlist,
reserve the attempt in the local ledger, place the call through whichever
provider was supplied, validate what came back, then fold transport and
business state into one outcome. Nothing later in the chain can rescue a
refusal earlier in it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any

from .authorization import (
    AuthorizationDecision,
    AuthorizationRefusal,
    CallAuthorization,
    authorize_call,
    mask_e164,
    normalize_e164,
)
from .contract import CONTRACT_VERSION, build_extraction_schema
from .disclosure import (
    TaskTextRefusal,
    build_disclosure,
    prohibited_task_text_violations,
)
from .envelope import SourceClaim, validate_source_claim
from .gates import (
    DEFAULT_POLICY_BOOK,
    DEFAULT_REQUIRED_REMEDIES,
    EconomicPolicy,
    VersionRefusal,
    assess_economics,
    assess_residual_necessity,
    check_source_version,
)
from .idempotency import derive_idempotency_key
from .ledger import (
    AttemptLedger,
    AttemptLedgerUnavailable,
    AttemptReconciliationRequired,
    LedgerRefusal,
    request_fingerprint,
)
from .observability import EventLog
from .outcome import WorkflowOutcome, derive_outcome
from .providers.base import CallProvider, CallRequest, recipient_routing
from .source import SourceVersionReader
from .validation import validate_structured_result

#: References are claim, case or credit numbers whose shape the organization
#: does not fix in the vertical slice, so the expected pattern is a bounded
#: alphanumeric canonical form. The read-back exchange, not the pattern, is
#: what carries the confirmation.
DEFAULT_REFERENCE_PATTERN = r"[A-Z0-9]{3,24}"

#: The read-back instruction is a property of the task text, not of the
#: schema, because the schema can only record that a read-back happened; only
#: the task can make it happen.
READBACK_INSTRUCTION = (
    "If they give you a claim, case or credit reference, read it back to them "
    "digit by digit and ask them to confirm it before you end the call. If "
    "they correct you, read the corrected value back and ask again. Do not "
    "end the call treating a reference as final until they have confirmed "
    "the value you read to them."
)

TRUTHFULNESS_INSTRUCTION = (
    "Do not guess, complete or tidy up anything they did not say. If they "
    "hedge or defer to a record they cannot see, treat the answer as not "
    "established."
)

AI_DISCLOSURE_INSTRUCTION = (
    "You are an AI assistant calling for {caller_organization}. Say so at the "
    "start of the call and never deny it."
)

BOUNDED_QUESTION = (
    "Ask them, and only this: the current status of this claim on their "
    "side; the reason it is being held, rejected, returned or left unpaid; "
    "any correction or documents they need from us; any deadline that "
    "applies; and where this should be escalated if it cannot be resolved. "
    "Do not dispute their decision, do not negotiate, and do not resubmit or "
    "appeal anything on this call."
)


def build_task(disclosure: dict[str, str]) -> str:
    """Compose the natural-language task CALL-E is asked to carry out.

    Takes the disclosure payload, never the envelope, so no field outside
    :data:`warrantyops.disclosure.DISCLOSURE_ALLOWLIST` can reach the call.
    """

    lines = [
        AI_DISCLOSURE_INSTRUCTION.format(
            caller_organization=disclosure["caller_organization"]
        ),
        "",
        f"Claim reference on our side: {disclosure['source_claim_id']} on "
        f"{disclosure['source_platform']}.",
        f"Our account with you: {disclosure['account_context']}.",
        f"Status on our side: {disclosure['exception_status']}.",
    ]
    if disclosure.get("documented_code"):
        lines.append(
            f"Reject or return code we can already see: {disclosure['documented_code']}."
        )
    lines.append("")
    lines.append(BOUNDED_QUESTION)
    lines.append("")
    lines.append(READBACK_INSTRUCTION)
    lines.append(TRUTHFULNESS_INSTRUCTION)
    return "\n".join(lines)


class RefusalGate(str, Enum):
    """Which gate refused. A refusal never reaches a later gate."""

    ENVELOPE = "ENVELOPE"
    RESIDUAL_NECESSITY = "RESIDUAL_NECESSITY"
    SOURCE_STATE = "SOURCE_STATE"
    ECONOMICS = "ECONOMICS"
    AUTHORIZATION = "AUTHORIZATION"
    DISCLOSURE = "DISCLOSURE"
    ATTEMPT_LEDGER = "ATTEMPT_LEDGER"


@dataclass(frozen=True)
class WorkflowRefusal:
    """A run that never became a call."""

    gate: RefusalGate
    reasons: tuple[str, ...]
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "refused": True,
            "gate": self.gate.value,
            "reasons": list(self.reasons),
            "details": dict(self.details),
        }


@dataclass(frozen=True)
class CaseRun:
    """What one run produced, plus the key any write-back must anchor to."""

    idempotency_key: str | None
    outcome: WorkflowOutcome | None = None
    refusal: WorkflowRefusal | None = None

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"idempotency_key": self.idempotency_key}
        if self.refusal is not None:
            body.update(self.refusal.to_dict())
        else:
            body.update(self.outcome.to_dict())  # type: ignore[union-attr]
        return body


def _trace(events: EventLog | None, name: str, **fields: object) -> None:
    """Emit one structured event when a run is being observed."""

    if events is not None:
        events.emit(name, **fields)


def run_exception(
    claim: SourceClaim,
    authorization: CallAuthorization,
    provider: CallProvider,
    *,
    policy_book: dict[str, EconomicPolicy] | None = None,
    required_remedies: tuple[str, ...] = DEFAULT_REQUIRED_REMEDIES,
    version_reader: SourceVersionReader | None = None,
    attempt_ledger: AttemptLedger | None = None,
    namespace: str = "warrantyops",
    now: datetime | None = None,
    on: date | None = None,
    allowlist: frozenset[str] | None = None,
    recheck_token: str | None = None,
    events: EventLog | None = None,
) -> CaseRun:
    """Run one claim exception end to end against whichever provider was given.

    ``events``, when supplied, receives the run's structured observability
    stream: start, each gate that passed, the reservation, the created call,
    and the terminal classification — or the gate that refused. The stream
    is diagnostic only; receipts and proof artifacts never read it, so a
    run's published outputs stay byte-deterministic with or without it.
    """

    if events is not None:
        events.emit(
            "run_started",
            note="one authorized residual claim exception",
            provider=provider.name,
        )
    run = _run_exception(
        claim,
        authorization,
        provider,
        policy_book=policy_book,
        required_remedies=required_remedies,
        version_reader=version_reader,
        attempt_ledger=attempt_ledger,
        namespace=namespace,
        now=now,
        on=on,
        allowlist=allowlist,
        recheck_token=recheck_token,
        events=events,
    )
    if events is not None:
        if run.refusal is not None:
            events.emit(
                "gate_refused",
                gate=run.refusal.gate.value,
                refusals=list(run.refusal.reasons),
            )
        elif run.outcome is not None:
            events.emit(
                "outcome_derived", terminal_state=run.outcome.terminal_state.value
            )
    return run


def _run_exception(
    claim: SourceClaim,
    authorization: CallAuthorization,
    provider: CallProvider,
    *,
    policy_book: dict[str, EconomicPolicy] | None = None,
    required_remedies: tuple[str, ...] = DEFAULT_REQUIRED_REMEDIES,
    version_reader: SourceVersionReader | None = None,
    attempt_ledger: AttemptLedger | None = None,
    namespace: str = "warrantyops",
    now: datetime | None = None,
    on: date | None = None,
    allowlist: frozenset[str] | None = None,
    recheck_token: str | None = None,
    events: EventLog | None = None,
) -> CaseRun:
    """The gate chain itself. Every stage can refuse; nothing rescues."""

    policies = DEFAULT_POLICY_BOOK if policy_book is None else policy_book

    envelope_decision = validate_source_claim(claim, on=on)
    if not envelope_decision.ok:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ENVELOPE,
                reasons=tuple(r.value for r in envelope_decision.refusals),
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.ENVELOPE.value)
    residual = assess_residual_necessity(claim, required_remedies=required_remedies)
    if not residual.allowed:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.RESIDUAL_NECESSITY,
                reasons=tuple(r.value for r in residual.refusals),
                details={"missing_remedies": list(residual.missing_remedies)},
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.RESIDUAL_NECESSITY.value)
    # The changed-state check is mandatory, not best-effort. Without a reader
    # the live version cannot be re-read, so a stale envelope could be dialled
    # as if it were current; the run refuses rather than skip the check.
    if version_reader is None:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.SOURCE_STATE,
                reasons=(VersionRefusal.SOURCE_RECHECK_UNAVAILABLE.value,),
                details={
                    "reason": (
                        "no source version reader was supplied, so the current "
                        "record version could not be re-read before dialing"
                    ),
                    "envelope_version": claim.source_version,
                },
            ),
        )
    version_decision = check_source_version(claim, version_reader)
    if not version_decision.matches:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.SOURCE_STATE,
                reasons=tuple(r.value for r in version_decision.refusals),
                details={
                    "envelope_version": version_decision.envelope_version,
                    "current_version": version_decision.current_version,
                },
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.SOURCE_STATE.value)
    economics = assess_economics(claim, policy_book=policies, on=on)
    if not economics.allowed:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ECONOMICS,
                reasons=tuple(r.value for r in economics.refusals),
                details={"policy_id": economics.policy_id},
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.ECONOMICS.value)
    decision: AuthorizationDecision = authorize_call(
        authorization,
        requested_purpose=authorization.purpose,
        now=now,
        allowlist=allowlist,
    )
    if not decision.allowed:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.AUTHORIZATION,
                reasons=tuple(r.value for r in decision.refusals),
                details={"authorization": decision.to_dict()},
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.AUTHORIZATION.value)
    # The authorization is bound to one destination: the number on the claim.
    # A record that authorizes calling one number never becomes permission to
    # dial a different claim's counterparty, so the two are compared — after
    # normalization, before the provider is touched — and a mismatch refuses.
    if normalize_e164(authorization.recipient_e164) != normalize_e164(
        claim.counterparty_phone_e164
    ):
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.AUTHORIZATION,
                reasons=(AuthorizationRefusal.AUTHORIZED_RECIPIENT_MISMATCH.value,),
                details={
                    "reason": (
                        "the authorized recipient is not the counterparty number "
                        "on the claim"
                    ),
                    "authorized_recipient": mask_e164(authorization.recipient_e164),
                    "claim_counterparty": mask_e164(claim.counterparty_phone_e164),
                },
            ),
        )

    # The composed task is checked as composed: after the allowlist has done
    # its structural work on the payload, and before anything reserves or
    # dials. No field that reached the builder — allowlisted or carried inside
    # a field's own text — can instruct the call to adjudicate, approve,
    # resubmit, negotiate, settle, retry or promise. Negated mentions ("do not
    # negotiate") are boundaries and pass; the check is on the final text.
    task = build_task(build_disclosure(claim))
    prohibited = prohibited_task_text_violations(task)
    if prohibited:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.DISCLOSURE,
                reasons=(TaskTextRefusal.PROHIBITED_TASK_TEXT.value,),
                details={
                    "violations": list(prohibited),
                    "reason": (
                        "the composed task text instructs a prohibited action; "
                        "an inquiry call may ask, it may not act"
                    ),
                },
            ),
        )

    _trace(events, "gate_passed", gate=RefusalGate.DISCLOSURE.value)
    key = derive_idempotency_key(
        namespace=namespace,
        authorization_record_reference=authorization.record_reference,
        source_platform=claim.source_platform,
        source_claim_id=claim.source_claim_id,
        source_version=claim.source_version,
        contract_version=CONTRACT_VERSION,
        recheck_token=recheck_token,
    )
    schema = build_extraction_schema()
    recipient_region, recipient_locale = recipient_routing(authorization.recipient_e164)
    request = CallRequest(
        task=task,
        recipient_e164=authorization.recipient_e164,
        result_schema=schema,
        idempotency_key=key,
        metadata={
            "app": "warrantyops",
            "contract_version": CONTRACT_VERSION,
            "source_platform": claim.source_platform,
            "source_claim_id": claim.source_claim_id,
            "source_version": claim.source_version,
            "authorization_record_reference": authorization.record_reference,
        },
        locale=recipient_locale,
        region=recipient_region,
    )
    # Local duplicate-call suppression is the primary control. The vendor's
    # idempotency replay is defence in depth and its guarantee is unverified,
    # so nothing here depends on it: the key and a fingerprint of the exact
    # request are reserved atomically before the provider is touched, and an
    # existing reservation — whatever its state — means this run places no
    # call. A ledger that cannot be opened is a refusal, not a bypass.
    if attempt_ledger is None:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ATTEMPT_LEDGER,
                reasons=(LedgerRefusal.ATTEMPT_LEDGER_UNAVAILABLE.value,),
                details={
                    "reason": (
                        "no attempt ledger was supplied, so a duplicate call "
                        "could not be suppressed locally"
                    )
                },
            ),
        )
    if getattr(provider, "requires_durable_ledger", False) and not attempt_ledger.durable:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ATTEMPT_LEDGER,
                reasons=(LedgerRefusal.LEDGER_NOT_DURABLE.value,),
                details={
                    "reason": (
                        "a live-capable provider requires a durable attempt "
                        "ledger; an in-memory ledger cannot suppress a retry "
                        "after a crash"
                    )
                },
            ),
        )
    fingerprint = request_fingerprint(request)
    try:
        reservation = attempt_ledger.reserve(key, fingerprint)
    except AttemptLedgerUnavailable as error:
        return CaseRun(
            idempotency_key=None,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ATTEMPT_LEDGER,
                reasons=(LedgerRefusal.ATTEMPT_LEDGER_UNAVAILABLE.value,),
                details={"reason": str(error)},
            ),
        )
    if not reservation.created:
        if reservation.request_fingerprint == fingerprint:
            _trace(
                events,
                "duplicate_suppressed",
                refusal=LedgerRefusal.DUPLICATE_CALL_SUPPRESSED.value,
                state=reservation.state.value,
            )
            return CaseRun(
                idempotency_key=key,
                refusal=WorkflowRefusal(
                    gate=RefusalGate.ATTEMPT_LEDGER,
                    reasons=(LedgerRefusal.DUPLICATE_CALL_SUPPRESSED.value,),
                    details={
                        "reservation": reservation.to_dict(),
                        "reason": (
                            "this claim version was already attempted; "
                            "reconciliation of the earlier attempt is a human "
                            "decision, never an automatic retry"
                        ),
                    },
                ),
            )
        _trace(
            events,
            "duplicate_suppressed",
            refusal=LedgerRefusal.IDEMPOTENCY_CONFLICT.value,
            state=reservation.state.value,
        )
        return CaseRun(
            idempotency_key=key,
            refusal=WorkflowRefusal(
                gate=RefusalGate.ATTEMPT_LEDGER,
                reasons=(LedgerRefusal.IDEMPOTENCY_CONFLICT.value,),
                details={
                    "reservation": reservation.to_dict(),
                    "reason": (
                        "this key was already reserved for a different request "
                        "body"
                    ),
                },
            ),
        )

    # The trace carries the digest part only: the namespace prefix is
    # constant across every run and carries no correlation information.
    key_prefix = key.rsplit(":", 1)[-1][:12]
    _trace(events, "reserved", to_state="RESERVED", key_prefix=key_prefix)

    def _created(call_id: str) -> None:
        _trace(events, "call_created", key_prefix=key_prefix)
        attempt_ledger.attach_call_id(key, call_id)

    try:
        call = provider.place_call(
            request,
            # The provider reports the vendor call id the moment creation
            # succeeds and before the first status read; persisting it here
            # is what makes a crash-in-between reconcilable by a human.
            on_call_created=_created,
        )
    except BaseException as error:
        # The attempt's outcome is unknown (the provider may or may not have
        # dialled). Mark it, never retry it, and surface the failure. When
        # the ledger itself could not record the outcome — including the
        # case where persisting the call id after a successful creation
        # failed — the durable reservation is what suppresses the retry, and
        # a human has to reconcile the attempt against the vendor records.
        try:
            attempt_ledger.mark_unknown(key)
        except AttemptLedgerUnavailable:
            raise AttemptReconciliationRequired(
                f"attempt {key} ended with an uncertain outcome and the ledger "
                "could not record it; the durable reservation is retained and "
                "manual reconciliation is required"
            ) from error
        if isinstance(error, AttemptLedgerUnavailable):
            raise AttemptReconciliationRequired(
                "the call may have been created but its id could not be "
                f"persisted for attempt {key}; the reservation is retained and "
                "manual reconciliation is required"
            ) from error
        raise
    if call.transport.is_terminal:
        attempt_ledger.mark_completed(key)
    else:
        # A non-terminal return is an uncertain result: the workflow stops
        # here with an in-flight outcome and the reservation stays UNKNOWN.
        attempt_ledger.mark_unknown(key)
    validation = validate_structured_result(call.structured_result, schema)
    outcome = derive_outcome(
        call.transport,
        validation,
        transcript=call.transcript or None,
        expected_reference_pattern=DEFAULT_REFERENCE_PATTERN,
    )
    return CaseRun(idempotency_key=key, outcome=outcome)


def masked_report(run: CaseRun, recipient_e164: str) -> dict[str, Any]:
    """The only shape this application prints. The number is always masked."""

    body = run.to_dict()
    body["recipient"] = mask_e164(recipient_e164)
    return body
