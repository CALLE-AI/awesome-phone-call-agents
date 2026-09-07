"""The case record: what was authorized, what was called, what came back.

The case file is the only durable state. It is written after every hop, so an
interrupted run resumes without re-dialling anyone, and so the evidence pack
can be rebuilt from disk long after the process is gone.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from runaround import phone
from runaround.chain import CHAIN_CONTINUE, Desk

CASE_FILE_SUFFIX = ".case.json"

DEFAULT_HOP_BUDGET = 4


class CaseError(RuntimeError):
    """Raised when a case cannot be loaded, created, or advanced."""


@dataclass
class Hop:
    """One placed call and what it produced."""

    index: int
    desk: Desk
    authorized_by: str
    call_id: str | None = None
    call_status: str | None = None
    outcome: str | None = None
    reason: str | None = None
    answer: str | None = None
    reference_number: str | None = None
    referral: dict[str, Any] | None = None
    started_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "desk": self.desk.to_dict(),
            "authorized_by": self.authorized_by,
            "call_id": self.call_id,
            "call_status": self.call_status,
            "outcome": self.outcome,
            "reason": self.reason,
            "answer": self.answer,
            "reference_number": self.reference_number,
            "referral": self.referral,
            "started_at": self.started_at,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Hop:
        return Hop(
            index=int(data["index"]),
            desk=Desk.from_dict(data["desk"]),
            authorized_by=str(data.get("authorized_by", "unknown")),
            call_id=data.get("call_id"),
            call_status=data.get("call_status"),
            outcome=data.get("outcome"),
            reason=data.get("reason"),
            answer=data.get("answer"),
            reference_number=data.get("reference_number"),
            referral=data.get("referral"),
            started_at=data.get("started_at"),
        )


@dataclass
class Case:
    """One question being chased across organizations."""

    case_id: str
    subject: str
    question: str
    requester_name: str
    requester_phone: str | None = None
    region: str | None = None
    locale: str | None = None
    hop_budget: int = DEFAULT_HOP_BUDGET
    status: str = "open"
    status_reason: str = "no call has been placed yet"
    authorized_desks: list[Desk] = field(default_factory=list)
    intake_identities: list[str] = field(default_factory=list)
    hops: list[Hop] = field(default_factory=list)
    pending_desk: Desk | None = None
    loop_path: list[str] = field(default_factory=list)

    # -- identity -----------------------------------------------------

    def authorized_identities(self) -> set[str]:
        return {desk.identity() for desk in self.authorized_desks}

    def visited_desks(self) -> list[Desk]:
        return [hop.desk for hop in self.hops]

    def hops_used(self) -> int:
        return len(self.hops)

    def history(self) -> list[dict[str, Any]]:
        """Referral history handed to the next call, oldest first."""
        entries: list[dict[str, Any]] = []
        for hop in self.hops:
            quote = (hop.referral or {}).get("quote")
            entries.append({"name": hop.desk.name, "quote": quote})
        return entries

    def next_desk(self) -> Desk | None:
        """Return the desk the next call would reach, if any."""
        if self.status == "open" and not self.hops:
            return self.authorized_desks[0] if self.authorized_desks else None
        if self.status == CHAIN_CONTINUE:
            return self.pending_desk
        return None

    def authorize(self, desk: Desk) -> None:
        if desk.identity() in self.authorized_identities():
            return
        self.authorized_desks.append(desk)

    # -- persistence --------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "subject": self.subject,
            "question": self.question,
            "requester_name": self.requester_name,
            "requester_phone": self.requester_phone,
            "region": self.region,
            "locale": self.locale,
            "hop_budget": self.hop_budget,
            "status": self.status,
            "status_reason": self.status_reason,
            "authorized_desks": [desk.to_dict() for desk in self.authorized_desks],
            "intake_identities": self.intake_identities,
            "hops": [hop.to_dict() for hop in self.hops],
            "pending_desk": self.pending_desk.to_dict() if self.pending_desk else None,
            "loop_path": self.loop_path,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Case:
        pending = data.get("pending_desk")
        return Case(
            case_id=str(data["case_id"]),
            subject=str(data["subject"]),
            question=str(data["question"]),
            requester_name=str(data["requester_name"]),
            requester_phone=data.get("requester_phone"),
            region=data.get("region"),
            locale=data.get("locale"),
            hop_budget=int(data.get("hop_budget", DEFAULT_HOP_BUDGET)),
            status=str(data.get("status", "open")),
            status_reason=str(data.get("status_reason", "")),
            authorized_desks=[
                Desk.from_dict(item) for item in data.get("authorized_desks", [])
            ],
            intake_identities=list(data.get("intake_identities", [])),
            hops=[Hop.from_dict(item) for item in data.get("hops", [])],
            pending_desk=Desk.from_dict(pending) if pending else None,
            loop_path=list(data.get("loop_path", [])),
        )


def case_path(data_dir: Path, case_id: str) -> Path:
    return Path(data_dir) / f"{case_id}{CASE_FILE_SUFFIX}"


def save_case(data_dir: Path, case: Case) -> Path:
    path = case_path(data_dir, case.case_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(case.to_dict(), indent=2, ensure_ascii=True) + "\n"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)
    return path


def load_case(data_dir: Path, case_id: str) -> Case:
    path = case_path(data_dir, case_id)
    if not path.exists():
        raise CaseError(f"no case {case_id!r} under {data_dir}")
    return Case.from_dict(json.loads(path.read_text(encoding="utf-8")))


def list_cases(data_dir: Path) -> list[Case]:
    directory = Path(data_dir)
    if not directory.exists():
        return []
    cases = []
    for path in sorted(directory.glob(f"*{CASE_FILE_SUFFIX}")):
        cases.append(Case.from_dict(json.loads(path.read_text(encoding="utf-8"))))
    return cases


def build_case(spec: dict[str, Any]) -> Case:
    """Create a case from an intake document.

    Every desk named in the intake is authorized by the person who wrote it.
    Desks discovered later on a call are not.
    """
    required = ("case_id", "subject", "question", "requester_name", "first_desk")
    missing = [key for key in required if key not in spec]
    if missing:
        raise CaseError("intake is missing: " + ", ".join(missing))

    first = Desk.from_dict(spec["first_desk"])
    requester_phone = spec.get("requester_phone")
    if requester_phone is not None:
        requester_phone = phone.normalize(str(requester_phone))

    case = Case(
        case_id=str(spec["case_id"]),
        subject=str(spec["subject"]),
        question=str(spec["question"]),
        requester_name=str(spec["requester_name"]),
        requester_phone=requester_phone,
        region=spec.get("region"),
        locale=spec.get("locale"),
        hop_budget=int(spec.get("hop_budget", DEFAULT_HOP_BUDGET)),
        authorized_desks=[first],
    )
    for extra in spec.get("also_authorized", []):
        case.authorize(Desk.from_dict(extra))
    case.intake_identities = [desk.identity() for desk in case.authorized_desks]
    return case
