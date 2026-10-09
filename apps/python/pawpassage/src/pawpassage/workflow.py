from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .approval import ApprovalReceipt, verify_approval
from .calle_transport import DispatchBinding, OfficialCalleTransport, TerminalOutcome
from .contracts import ResultContractError, validate_and_evaluate
from .ledger import CallLedger, LedgerRecord
from .models import Checkpoint, JourneyCase
from .preview import build_preview, dispatch_idempotency_key, preview_digest


@dataclass(frozen=True, slots=True)
class ExecutionReport:
    case_id: str
    checkpoint_id: str
    recipient_masked: str
    mode: str
    ledger_state: str
    disposition: str
    reason_codes: tuple[str, ...]
    provider_call_id: str | None
    intent_key: str
    preview_digest: str
    duplicate_prevented: bool
    result: dict[str, Any] | None
    authority_boundary: str = "Human review only: this report never books, pays, certifies health, or grants travel clearance."
    provider_diagnostic: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PawPassageWorkflow:
    def __init__(self, ledger: CallLedger) -> None:
        self.ledger = ledger

    def prepare(self, case: JourneyCase, checkpoint: Checkpoint) -> dict[str, Any]:
        return build_preview(case, checkpoint)

    def execute(
        self,
        *,
        case: JourneyCase,
        checkpoint: Checkpoint,
        approval: ApprovalReceipt,
        transport: OfficialCalleTransport,
        mode: str,
        poll_interval_seconds: float = 2.0,
        poll_timeout_seconds: float = 600.0,
    ) -> ExecutionReport:
        _verify_transport_mode(transport, mode)
        preview = self.prepare(case, checkpoint)
        verify_approval(preview, approval, required_mode=mode)
        intent_key = dispatch_idempotency_key(preview, approval.preview_digest)
        record, created = self.ledger.reserve(
            intent_key=intent_key,
            case_id=case.case_id,
            checkpoint_id=checkpoint.checkpoint_id,
            preview_digest=preview_digest(preview),
            recipient_masked=preview["recipientMasked"],
        )
        if not created:
            return _report(record, mode=mode, duplicate_prevented=True)

        binding = _binding(preview, checkpoint, intent_key)
        submission = transport.submit(binding)
        if submission.kind == "REJECTED":
            record = self.ledger.mark_rejected(
                intent_key,
                submission.reason_code or "CREATE_REJECTED",
                provider_diagnostic=submission.provider_diagnostic,
            )
            return _report(record, mode=mode)
        if submission.kind != "ACCEPTED" or not submission.call_id:
            record = self.ledger.mark_submission_unknown(
                intent_key,
                submission.reason_code or "CREATE_OUTCOME_UNKNOWN",
                call_id=submission.call_id,
            )
            return _report(record, mode=mode)

        self.ledger.mark_accepted(intent_key, submission.call_id)
        terminal = transport.wait_for_terminal(
            submission.call_id,
            binding,
            interval_seconds=poll_interval_seconds,
            timeout_seconds=poll_timeout_seconds,
        )
        return self._finish_terminal(intent_key, terminal, mode=mode)

    def reconcile(
        self,
        *,
        case: JourneyCase,
        checkpoint: Checkpoint,
        approval: ApprovalReceipt,
        transport: OfficialCalleTransport,
        mode: str,
    ) -> ExecutionReport:
        """Read one known accepted call; never calls the create endpoint."""

        _verify_transport_mode(transport, mode)
        preview = self.prepare(case, checkpoint)
        # Expiry limits new calls. Reading an already accepted call can outlive
        # the original call window, but must retain the exact content binding.
        verify_approval(preview, approval, required_mode=mode, require_fresh_live=False)
        intent_key = dispatch_idempotency_key(preview, approval.preview_digest)
        record = self.ledger.get(intent_key)
        if record is None or record.state != "ACCEPTED" or not record.provider_call_id:
            raise ValueError(
                "Only a known ACCEPTED call can be reconciled without creating a call"
            )
        terminal = transport.reconcile(
            record.provider_call_id,
            _binding(preview, checkpoint, intent_key),
        )
        return self._finish_terminal(intent_key, terminal, mode=mode)

    def _finish_terminal(
        self, intent_key: str, terminal: TerminalOutcome, *, mode: str
    ) -> ExecutionReport:
        if terminal.kind == "PENDING":
            record = self.ledger.mark_read_pending(
                intent_key, terminal.reason_code or "CALL_NOT_TERMINAL"
            )
            return _report(record, mode=mode)
        if terminal.kind != "COMPLETED" or terminal.raw_result is None:
            record = self.ledger.mark_terminal(
                intent_key,
                state="NEEDS_HUMAN",
                disposition="NEEDS_HUMAN_RECONCILIATION",
                reason_codes=(terminal.reason_code or "TERMINAL_OUTCOME_AMBIGUOUS",),
                result=None,
            )
            return _report(record, mode=mode)
        try:
            evaluated = validate_and_evaluate(terminal.raw_result)
        except ResultContractError as error:
            record = self.ledger.mark_terminal(
                intent_key,
                state="NEEDS_HUMAN",
                disposition="NEEDS_HUMAN_REVIEW",
                reason_codes=(str(error),),
                result=None,
            )
            return _report(record, mode=mode)
        record = self.ledger.mark_terminal(
            intent_key,
            disposition=evaluated.disposition,
            reason_codes=evaluated.reason_codes,
            result=evaluated.result,
        )
        return _report(record, mode=mode)


def _verify_transport_mode(transport: OfficialCalleTransport, mode: str) -> None:
    if mode not in {"fake", "live"} or transport.live != (mode == "live"):
        raise ValueError("Transport mode does not match the approved workflow mode")


def journey_disposition(reports: list[ExecutionReport]) -> str:
    dispositions = {report.disposition for report in reports}
    if "DO_NOT_CONTACT" in dispositions:
        return "STOP_CONTACT_AND_HUMAN_REVIEW"
    if (
        "NEEDS_HUMAN_RECONCILIATION" in dispositions
        or "NEEDS_HUMAN_REVIEW" in dispositions
    ):
        return "HUMAN_REVIEW_REQUIRED"
    if "GAPS_FOUND" in dispositions:
        return "ROUTE_GAPS_REQUIRE_HUMAN_ACTION"
    if dispositions == {"EVIDENCE_PACKET_READY"}:
        return "EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW"
    return "HUMAN_REVIEW_REQUIRED"


def _binding(
    preview: dict[str, Any], checkpoint: Checkpoint, intent_key: str
) -> DispatchBinding:
    metadata = {
        "workflow": "pawpassage",
        "caseId": preview["caseId"],
        "checkpointId": preview["checkpointId"],
        "previewDigest": preview_digest(preview),
        "intentReference": intent_key,
    }
    return DispatchBinding(
        task=preview["task"],
        phone_e164=checkpoint.phone_e164,
        region=checkpoint.region,
        locale=checkpoint.locale,
        result_schema=preview["recipientResultSchema"],
        metadata=metadata,
        idempotency_key=intent_key,
    )


def _report(
    record: LedgerRecord, *, mode: str, duplicate_prevented: bool = False
) -> ExecutionReport:
    disposition = record.disposition or (
        "CALL_IN_PROGRESS"
        if record.state == "ACCEPTED"
        else "NEEDS_HUMAN_RECONCILIATION"
    )
    reasons = record.reason_codes or (
        ("EXISTING_INTENT_REQUIRES_RECONCILIATION",) if duplicate_prevented else ()
    )
    return ExecutionReport(
        case_id=record.case_id,
        checkpoint_id=record.checkpoint_id,
        recipient_masked=record.recipient_masked,
        mode=mode,
        ledger_state=record.state,
        disposition=disposition,
        reason_codes=reasons,
        provider_call_id=record.provider_call_id,
        intent_key=record.intent_key,
        preview_digest=record.preview_digest,
        duplicate_prevented=duplicate_prevented,
        result=record.result,
        provider_diagnostic=record.provider_diagnostic,
    )
