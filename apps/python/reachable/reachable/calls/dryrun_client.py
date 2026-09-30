"""The dry-run client: renders a masked preview and never dials.

This is the default transport. With ``REACHABLE_LIVE_CALLS`` unset, every code
path still runs -- the task is rendered, the schema built, the idempotency key
derived and reserved, the destination masked and displayed -- and only the
network request does not happen.

Calling :meth:`create` is itself an error rather than a silent no-op: if the
orchestrator ever reaches a transport while in dry run, that is a guard bug, and
it should be loud.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..phone import mask
from .client import CallError, CallHandle, CallRequest


@dataclass
class Preview:
    """Exactly what would be said, and to whom, with the number masked."""

    task: str
    result_schema: dict[str, Any]
    masked_destination: str
    idempotency_key: str
    metadata: dict[str, Any]
    region: str
    locale: str

    @classmethod
    def of(cls, request: CallRequest) -> "Preview":
        return cls(
            task=request.task,
            result_schema=request.result_schema,
            masked_destination=mask(request.destination),
            idempotency_key=request.idempotency_key,
            metadata=dict(request.metadata),
            region=request.region,
            locale=request.locale,
        )

    def as_text(self) -> str:
        lines = [
            f"Destination     {self.masked_destination}",
            f"Region/locale   {self.region} / {self.locale}",
            f"Idempotency key {self.idempotency_key}",
            "",
            "Exactly what will be said:",
            "",
            self.task,
        ]
        return "\n".join(lines)


@dataclass
class DryRunClient:
    """Records what it was asked to do. Places no call, ever."""

    previews: list[Preview] = field(default_factory=list)

    def create(self, request: CallRequest) -> CallHandle:
        self.previews.append(Preview.of(request))
        raise CallError(
            "dry run: no call was placed. Set REACHABLE_LIVE_CALLS=1 and confirm "
            "the specific call to place it."
        )

    def preview(self, request: CallRequest) -> Preview:
        """Render without pretending to dial. What the dashboard shows."""
        rendered = Preview.of(request)
        self.previews.append(rendered)
        return rendered

    def get(self, call_id: str) -> dict[str, Any]:
        raise CallError("dry run: there is no call to read back")
