"""JSONL stores, masking, and the append-only audit log."""
import json
import os
from pathlib import Path

from .models import CallOutcome, Reservation, WaitlistEntry

DIALLED_STATUSES = {
    "CONFIRMED",
    "CANCELLED",
    "RESCHEDULED",
    "NO_ANSWER",
    "ACCEPTED",
    "DECLINED",
    "ERROR",
}


def read_jsonl(path: str | Path) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped:
                rows.append(json.loads(stripped))
    return rows


def write_jsonl_atomic(path: str | Path, rows: list[dict]) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def mask_phone(phone: str) -> str:
    digits = phone.lstrip("+")
    return "+" + "*" * max(len(digits) - 2, 0) + digits[-2:]


def load_reservations(path: str | Path) -> list[Reservation]:
    return [Reservation.from_line(row) for row in read_jsonl(path)]


def load_waitlist(path: str | Path) -> list[WaitlistEntry]:
    return [WaitlistEntry.from_line(row) for row in read_jsonl(path)]


class AuditLog:
    """Append-only audit trail per run; powers duplicate-call prevention."""

    def __init__(self, run_dir: str | Path):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.run_dir / "audit.jsonl"

    def append(self, outcome: CallOutcome) -> None:
        record = {
            "run_id": outcome.run_id,
            "target_id": outcome.target_id,
            "status": outcome.status.value,
            "new_slot": outcome.new_slot,
            "notes": outcome.notes,
            "transcript_ref": outcome.transcript_ref,
            "call_cost_id": outcome.call_cost_id,
        }
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def records(self) -> list[dict]:
        return read_jsonl(self.path) if self.path.exists() else []

    def dialed_targets(self) -> set[str]:
        return {
            row["target_id"]
            for row in self.records()
            if row["status"] in DIALLED_STATUSES
        }

    def is_cancelled(self) -> bool:
        return any(
            row["status"] == "CANCELLED_BY_OPERATOR" for row in self.records()
        )
