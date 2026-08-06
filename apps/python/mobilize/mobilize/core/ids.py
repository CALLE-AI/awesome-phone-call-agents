"""Deterministic mobilization IDs for the real-call entry points.

A timestamp- or UUID-based mobilization_id (what the CLI and MCP server
used before this fix) is a new, different ID on every invocation -- which
means a retry after a crash computes different per-candidate idempotency
keys than the run that crashed, defeating the idempotency-key-based
durability the ledger and transport rely on. Deriving the ID from the
request's own content instead means calling with the same need_label and
phones always reuses the same mobilization_id, so a resume genuinely
resumes rather than silently starting a parallel, indistinguishable run
that can redial everyone.
"""

from __future__ import annotations

import hashlib


def derive_mobilization_id(need_label: str, phones: list[str]) -> str:
    normalized = need_label.strip().lower() + "|" + ",".join(sorted(p.strip() for p in phones))
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"real_{digest}"
