"""The MCP surface: three tools, none of which can bypass the kernel.

§6.3 (locked): **three tools only** — assess claim, request authorized
inquiry, review and write back. Defaults are read-only/fake: the only
provider this module can construct is the fixture-replaying fake, there is
no live configuration path in it at all, and every write-back goes through
the kernel's own ``write_back`` with its review binding and source-version
re-read. A tool call that would dial for real simply has no code path here.

The dispatcher is protocol-agnostic JSON in/JSON out, so an MCP host binds
it without this repository depending on any SDK: ``serve_stdio`` reads one
``{"tool": ..., "arguments": {...}`` object per line and writes one
response object per line. Nothing in here imports the CALL-E SDK, and
``make judge`` never needs it.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional, TextIO

from .authorization import AuthorizationBasis, CallAuthorization
from .claim_adapter import AdapterRefusal, FixtureClaimAdapter
from .disclosure import (
    TaskTextRefusal,
    build_disclosure,
    prohibited_task_text_violations,
)
from .envelope import SourceClaim, validate_source_claim
from .gates import (
    DEFAULT_POLICY_BOOK,
    DEFAULT_REQUIRED_REMEDIES,
    assess_economics,
    assess_residual_necessity,
    check_source_version,
)
from .ledger import InMemoryAttemptLedger
from .outcome import WorkflowOutcome
from .providers.fake import FIXTURE_DIR, FakeCallProvider
from .review import ReviewDecision, ReviewPacket, ReviewRecord, prepare_review
from .source import InMemorySourceStore
from .workflow import RefusalGate, build_task, run_exception
from .writeback import InMemoryNoteLedger, WriteBackRefusal, write_back

__all__ = [
    "HANDLERS",
    "MCP_TOOLS",
    "McpRefusal",
    "ReviewSession",
    "dispatch_tool",
    "serve_stdio",
]

#: The surface is exactly this. A fourth tool cannot be added silently: a
#: test pins the registry to these three names.
MCP_TOOLS = ("assess_claim", "request_authorized_inquiry", "review_and_write_back")

#: Decisions the review tool accepts, and nothing else.
MCP_DECISIONS = frozenset(
    {
        ReviewDecision.APPROVE.value,
        ReviewDecision.REFUSE.value,
        ReviewDecision.RETURN_TO_DIGITAL.value,
    }
)

PURPOSE = "warranty claim exception follow-up"


class McpRefusal(ValueError):
    """The tool refused; the named reasons travel to the caller."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


@dataclass
class ReviewSession:
    """What tool 2 leaves for tool 3: kernel outputs, nothing else."""

    packet: ReviewPacket
    claim: SourceClaim
    outcome: WorkflowOutcome
    store: InMemorySourceStore
    idempotency_key: str
    evidence_pointer: Optional[str]
    decided: bool = False


#: The default session registry, keyed by review_id. Per-process only: a
#: restart forgets everything, and nothing here is ever persisted. Callers
#: that need isolation (tests, one-shot hosts) pass their own dict.
_SESSIONS: dict[str, ReviewSession] = {}


def _fixture_path(name: str) -> Path:
    # Scenario names may not travel: only file stems under the fixture dir,
    # no separators, no traversal. The path is constructed, never trusted.
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise McpRefusal([f"SCENARIO_NAME_INVALID:{name!r}"])
    path = FIXTURE_DIR / f"{name}.json"
    if not path.is_file():
        raise McpRefusal([f"SCENARIO_NOT_FOUND:{name}"])
    return path


def _snapshot_for(name: str, claim_id: str) -> tuple[FixtureClaimAdapter, str]:
    adapter = FixtureClaimAdapter(_fixture_path(name))
    wanted = claim_id or next(iter(adapter.snapshots))
    return adapter, wanted


def _authorization(recipient: str, now: datetime) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=recipient,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="mcp-surface",
        granted_at=now - timedelta(hours=1),
        expires_at=now + timedelta(hours=1),
        record_reference="synthetic://mcp-surface/authorization",
    )


# --- tool 1: assess claim (read-only; dials nothing) -----------------------------------


def assess_claim(
    arguments: Mapping[str, Any],
    *,
    on: Optional[date] = None,
) -> dict[str, Any]:
    """Run every gate that needs no call-time state against one fixture.

    Five of the kernel's seven gates are genuinely evaluable before any
    provider exists; the two that are not — AUTHORIZATION (checked against
    the authorization record at call time) and ATTEMPT_LEDGER (cross-run
    state) — are named in the response instead of silently skipped.
    """

    name = str(arguments.get("scenario", ""))
    adapter, wanted = _snapshot_for(name, str(arguments.get("claim_id", "")))
    snapshot = adapter.load_claim(wanted)
    claim = snapshot.claim
    today = on or date.today()

    envelope = validate_source_claim(claim, on=today)
    residual = assess_residual_necessity(
        claim, required_remedies=DEFAULT_REQUIRED_REMEDIES
    )
    version = check_source_version(claim, adapter)
    economics = assess_economics(claim, policy_book=DEFAULT_POLICY_BOOK, on=today)
    task = build_task(build_disclosure(claim))
    prohibited = prohibited_task_text_violations(task)

    gates = [
        {
            "gate": RefusalGate.ENVELOPE.value,
            "ok": envelope.ok,
            "refusals": [refusal.value for refusal in envelope.refusals],
        },
        {
            "gate": RefusalGate.RESIDUAL_NECESSITY.value,
            "ok": residual.allowed,
            "refusals": [refusal.value for refusal in residual.refusals],
        },
        {
            "gate": RefusalGate.SOURCE_STATE.value,
            "ok": version.matches,
            "refusals": [refusal.value for refusal in version.refusals],
        },
        {
            "gate": RefusalGate.ECONOMICS.value,
            "ok": economics.allowed,
            "refusals": [refusal.value for refusal in economics.refusals],
        },
        {
            "gate": RefusalGate.DISCLOSURE.value,
            "ok": not prohibited,
            "refusals": (
                [TaskTextRefusal.PROHIBITED_TASK_TEXT.value] if prohibited else []
            ),
        },
    ]
    return {
        "tool": "assess_claim",
        "scenario": name,
        "claim_id": snapshot.claim_id,
        "source_version": snapshot.source_version,
        "policy_book_id": snapshot.policy_book_id,
        "authorization_class": snapshot.authorization_class.value,
        "preflight_gates": gates,
        "preflight_ok": all(gate["ok"] for gate in gates),
        "gates_evaluated_at_call_time": [
            RefusalGate.AUTHORIZATION.value,
            RefusalGate.ATTEMPT_LEDGER.value,
        ],
        "real_calls_placed": 0,
    }


# --- tool 2: request authorized inquiry (fake provider, write-back withheld) ------------


def request_authorized_inquiry(
    arguments: Mapping[str, Any],
    *,
    now: Optional[datetime] = None,
    on: Optional[date] = None,
    sessions: Optional[dict[str, ReviewSession]] = None,
) -> dict[str, Any]:
    """One governed run against the fake provider. Real calls: zero."""

    name = str(arguments.get("scenario", ""))
    moment = now or datetime.now(timezone.utc)
    adapter, wanted = _snapshot_for(name, str(arguments.get("claim_id", "")))
    claim = adapter.load_claim(wanted).claim
    recipient = claim.counterparty_phone_e164
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    provider = FakeCallProvider(scenario=name)
    run = run_exception(
        claim,
        _authorization(recipient, moment),
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=moment,
        on=on or date.today(),
        allowlist=frozenset({recipient}),
    )
    if run.refusal is not None:
        return {
            "tool": "request_authorized_inquiry",
            "refused": True,
            "gate": run.refusal.gate.value,
            "reasons": list(run.refusal.reasons),
            "write_back": "NONE",
            "provider_replays": provider.replays,
            "real_calls_placed": 0,
        }
    assert run.outcome is not None  # CaseRun is exclusive by construction
    packet = prepare_review(run.outcome, recipient)
    registry = _SESSIONS if sessions is None else sessions
    registry[packet.review_id] = ReviewSession(
        packet=packet,
        claim=claim,
        outcome=run.outcome,
        store=store,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=run.outcome.transport.call_id,
    )
    return {
        "tool": "request_authorized_inquiry",
        "refused": False,
        "recipient": packet.recipient_masked,
        "terminal_state": run.outcome.terminal_state.value,
        "transport_state": run.outcome.transport.state.value,
        "review_id": packet.review_id,
        "packet_sha256": packet.packet_sha256,
        "write_back": "WITHHELD_PENDING_REVIEW",
        "provider_replays": provider.replays,
        "real_calls_placed": 0,
    }


# --- tool 3: review and write back (the kernel's own path) ------------------------------


def review_and_write_back(
    arguments: Mapping[str, Any],
    *,
    now: Optional[datetime] = None,
    sessions: Optional[dict[str, ReviewSession]] = None,
) -> dict[str, Any]:
    """Apply one human decision to a registered review, through the kernel."""

    review_id = str(arguments.get("review_id", ""))
    registry = _SESSIONS if sessions is None else sessions
    session = registry.get(review_id)
    if session is None:
        raise McpRefusal([f"REVIEW_NOT_FOUND:{review_id}"])
    if session.decided:
        raise McpRefusal(["REVIEW_ALREADY_DECIDED"])
    decision_name = str(arguments.get("decision", ""))
    if decision_name not in MCP_DECISIONS:
        raise McpRefusal([f"DECISION_UNKNOWN:{decision_name}"])
    reviewer = str(arguments.get("reviewer", ""))
    operator_id = str(arguments.get("operator_id", ""))
    if not reviewer.strip() or not operator_id.strip():
        raise McpRefusal(["MISSING_REVIEWER", "MISSING_OPERATOR_ID"])
    moment = now or datetime.now(timezone.utc)
    packet = session.packet
    record = ReviewRecord(
        decision=ReviewDecision(decision_name),
        reviewer=reviewer,
        decided_at=moment,
        review_id=packet.review_id,
        packet_sha256=packet.packet_sha256,
        operator_id=operator_id,
    )
    # One decision per review: the flag goes up before the write-back runs,
    # so a refused write cannot be retried with a different decision on the
    # same packet. A new decision needs a new inquiry.
    session.decided = True
    if record.decision is not ReviewDecision.APPROVE:
        return {
            "tool": "review_and_write_back",
            "decision": decision_name,
            "write_back": "NONE",
            "note_id": None,
            "safe_non_write": True,
        }
    result = write_back(
        session.claim,
        session.store,
        InMemoryNoteLedger(),
        packet,
        record,
        session.outcome,
        idempotency_key=session.idempotency_key,
        evidence_pointer=session.evidence_pointer,
        written_at=moment,
    )
    if isinstance(result, WriteBackRefusal):
        return {
            "tool": "review_and_write_back",
            "decision": decision_name,
            "write_back": result.value,
            "note_id": None,
            "safe_non_write": True,
        }
    return {
        "tool": "review_and_write_back",
        "decision": decision_name,
        "write_back": "NOTE_WRITTEN",
        "note_id": result.note_id,
        "note": dict(result.note),
        "safe_non_write": False,
    }


# --- dispatch and stdio ------------------------------------------------------------------


HANDLERS: dict[str, Callable[..., dict[str, Any]]] = {
    "assess_claim": assess_claim,
    "request_authorized_inquiry": request_authorized_inquiry,
    "review_and_write_back": review_and_write_back,
}


def dispatch_tool(
    name: str,
    arguments: Optional[Mapping[str, Any]] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """One tool call. Unknown names and refusals return named reasons."""

    if name not in MCP_TOOLS:
        return {"tool": name, "refused": True, "reasons": [f"TOOL_UNKNOWN:{name}"]}
    try:
        return HANDLERS[name](arguments or {}, **kwargs)
    except (McpRefusal, AdapterRefusal) as error:
        reasons = getattr(error, "reasons", [str(error)])
        return {"tool": name, "refused": True, "reasons": list(reasons)}


def serve_stdio(
    stdin: Optional[TextIO] = None,
    stdout: Optional[TextIO] = None,
) -> int:
    """The JSONL loop an MCP host drives. One call per line, one reply."""

    source = stdin if stdin is not None else sys.stdin
    sink = stdout if stdout is not None else sys.stdout
    handled = 0
    for line in source:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = dispatch_tool(
                str(request.get("tool", "")),
                request.get("arguments") or {},
            )
        except json.JSONDecodeError as error:
            response = {"refused": True, "reasons": [f"REQUEST_NOT_JSON:{error.msg}"]}
        sink.write(json.dumps(response, sort_keys=True) + "\n")
        sink.flush()
        handled += 1
    return handled


if __name__ == "__main__":  # pragma: no cover - a host binds serve_stdio directly
    raise SystemExit(serve_stdio())
