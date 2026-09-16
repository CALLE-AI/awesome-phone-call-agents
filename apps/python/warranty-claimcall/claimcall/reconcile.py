"""Reconcile a call and verify its result against call evidence.

The two ideas worth reusing from this file:

1. A timeout is a question, not permission to redial. `reconcile` reads the
   provider's own record; if the provider has never heard of the idempotency
   key, the call is held for a human rather than retried, because "we cannot
   prove a phone did not ring" is not the same as "no phone rang".

2. A structured result is a claim about a conversation, not the conversation.
   `check` refuses to call an outcome verified unless the transcript supports
   it - a reference number nobody said, a coverage decision nobody stated, or
   an appointment nobody offered all come back as needs_human.
"""

from __future__ import annotations

from typing import Any

from claimcall_core import (
    VerificationInput,
    normalize,
    verify,
)
from claimcall_core import (
    reconcile as core_reconcile,
)
from claimpilot_contracts import (
    CallIntent,
    CallManifest,
    ProviderCallRecord,
    VerificationVerdict,
    VerifiedCallOutcome,
)

__all__ = [
    "VerificationVerdict",
    "VerifiedCallOutcome",
    "check",
    "check_payload",
    "reconcile",
    "render_outcome",
]


def reconcile(intent: CallIntent, provider: Any):  # noqa: ANN201
    """Authoritative provider read; never a second submission."""
    return core_reconcile(intent, provider)


def check(
    manifest: CallManifest,
    record: ProviderCallRecord,
    problems: list[str] | None = None,
) -> VerifiedCallOutcome:
    return verify(
        VerificationInput(
            manifest=manifest, record=record, normalization_problems=problems or []
        )
    )


def check_payload(
    manifest: CallManifest, raw: dict[str, Any], *, intent_id: str = "cli"
) -> tuple[ProviderCallRecord, VerifiedCallOutcome]:
    """Verify a raw provider payload - useful for replaying a saved result."""
    record, problems = normalize(raw, intent_id=intent_id)
    return record, check(manifest, record, problems)


def render_outcome(outcome: VerifiedCallOutcome) -> str:
    lines = [f"Verification: {outcome.verdict.value.upper()}", f"  {outcome.reason}"]
    if outcome.supported_fields:
        lines.append(f"  Supported by call evidence: {', '.join(outcome.supported_fields)}")
    if outcome.unsupported_fields:
        lines.append(f"  NOT supported: {', '.join(outcome.unsupported_fields)}")
    for contradiction in outcome.contradictions:
        lines.append(f"  Contradiction: {contradiction}")
    for violation in outcome.authority_violations:
        lines.append(f"  Outside granted authority: {violation}")
    if outcome.preserved_unknowns:
        lines.append(f"  Left unknown on purpose: {', '.join(outcome.preserved_unknowns)}")
    lines.append(f"  Next claim state: {outcome.next_claim_state.value}")
    return "\n".join(lines)
