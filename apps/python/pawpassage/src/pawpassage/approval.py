from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .preview import preview_digest


class ApprovalError(ValueError):
    """Raised when an approval is absent, stale, or bound to different content."""


@dataclass(frozen=True, slots=True)
class ApprovalReceipt:
    schema_version: str
    preview_digest: str
    approved_by: str
    approved_at: str
    mode: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Any) -> ApprovalReceipt:
        expected = {
            "schema_version",
            "preview_digest",
            "approved_by",
            "approved_at",
            "mode",
        }
        if not isinstance(raw, dict) or set(raw) != expected:
            raise ApprovalError("Approval receipt has an invalid shape")
        if any(not isinstance(raw[key], str) for key in expected):
            raise ApprovalError("Approval receipt fields must be strings")
        return cls(**raw)


def create_approval(
    preview: dict[str, Any],
    *,
    presented_digest: str,
    approved_by: str,
    mode: str,
    now: datetime | None = None,
) -> ApprovalReceipt:
    expected = preview_digest(preview)
    if presented_digest != expected:
        raise ApprovalError("The entered digest does not match the exact preview")
    if mode not in {"fake", "live"}:
        raise ApprovalError("Approval mode must be fake or live")
    if not approved_by.strip() or len(approved_by.strip()) > 80:
        raise ApprovalError("approved_by must be short non-empty text")
    timestamp = (now or datetime.now(UTC)).astimezone(UTC)
    return ApprovalReceipt(
        schema_version="1.0",
        preview_digest=expected,
        approved_by=approved_by.strip(),
        approved_at=timestamp.isoformat().replace("+00:00", "Z"),
        mode=mode,
    )


def verify_approval(
    preview: dict[str, Any],
    receipt: ApprovalReceipt,
    *,
    required_mode: str,
    now: datetime | None = None,
    live_ttl: timedelta = timedelta(minutes=15),
    require_fresh_live: bool = True,
) -> None:
    if receipt.schema_version != "1.0":
        raise ApprovalError("Approval schema version is not supported")
    if receipt.mode != required_mode:
        raise ApprovalError("Approval mode does not match this execution mode")
    if receipt.preview_digest != preview_digest(preview):
        raise ApprovalError("Approval was issued for different call content")
    if required_mode == "live":
        try:
            approved_at = datetime.fromisoformat(receipt.approved_at)
        except ValueError as error:
            raise ApprovalError("Approval timestamp is invalid") from error
        if approved_at.tzinfo is None:
            raise ApprovalError("Approval timestamp must include a timezone")
        current = (now or datetime.now(UTC)).astimezone(UTC)
        approved_at = approved_at.astimezone(UTC)
        if approved_at > current + timedelta(seconds=30):
            raise ApprovalError("Approval timestamp is in the future")
        if require_fresh_live and current - approved_at > live_ttl:
            raise ApprovalError(
                "Live approval is stale; review the current preview again"
            )
