"""Manifest compilation for the CLI.

Thin over `claimcall_core.manifest` on purpose: this file exists so the CLI has
one obvious place to look, not so it can hold a second, subtly different copy
of the compiler. A safety rule that only held in one of two copies would be
worse than no rule.

What compilation guarantees:
  - only allowlisted fact paths become spoken disclosures;
  - the plan is sealed with a content hash, and consent binds to that hash;
  - the same plan compiled twice produces the same hash, so `--confirm` works
    across processes.
"""

from __future__ import annotations

from claimcall_core.manifest import (
    DEFAULT_ACCEPTABLE_OUTCOMES,
    DEFAULT_GOALS,
    DEFAULT_PROHIBITED,
    DISCLOSABLE_PATHS,
    compile_manifest,
    compute_manifest_hash,
    render_call_task,
    render_human,
    seal,
)
from claimpilot_contracts import CallManifest, FeeLimit

from .schemas import ClaimFile, to_claim_and_facts

__all__ = [
    "DEFAULT_ACCEPTABLE_OUTCOMES",
    "DEFAULT_GOALS",
    "DEFAULT_PROHIBITED",
    "DISCLOSABLE_PATHS",
    "build",
    "compute_manifest_hash",
    "render_call_task",
    "render_human",
    "seal",
]


def build(source: ClaimFile, *, version: int = 1, ttl_minutes: int = 15) -> CallManifest:
    """Compile a sealed manifest from a claim file."""
    claim, facts = to_claim_and_facts(source)
    return compile_manifest(
        claim,
        facts,
        version=version,
        questions=list(source.questions),
        fee_limit=FeeLimit(max_amount=source.max_fee, currency=source.currency),
        windows=list(source.approved_windows),
        ttl_minutes=ttl_minutes,
    )
