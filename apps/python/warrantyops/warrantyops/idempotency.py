"""Idempotency keys derived from what was authorized, bound to a claim version.

CALL-E returns the original call for a repeated ``Idempotency-Key``, so the key
has to be a property of *what was authorized*. A key derived from the attempt
(a fresh UUID per retry) creates a duplicate call; a key derived from the
authorization makes a lost response safe to retry and a double submission free.

v1 binds the key to the source claim **and its immutable source version**: the
same claim at a different source version is a different question about a
different record state, and must never reuse the earlier call's answer.

The same property makes a deliberate re-check a separate decision: it must pass
an explicit ``recheck_token``, because reusing the original key would return
the very answer being re-checked.
"""

from __future__ import annotations

import hashlib
import re

MAX_KEY_LENGTH = 255
_SAFE_NAMESPACE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


class IdempotencyError(ValueError):
    """Raised when a key cannot be derived from the inputs given."""


def derive_idempotency_key(
    *,
    namespace: str,
    authorization_record_reference: str,
    source_platform: str,
    source_claim_id: str,
    source_version: str,
    contract_version: str,
    recheck_token: str | None = None,
) -> str:
    """Return a stable key for one authorized claim-version-bound operation.

    The digest covers every input, so two operations that differ in any of them
    get different keys, and two attempts at the same operation get the same key
    however many times the workflow retries.
    """

    if not _SAFE_NAMESPACE_RE.fullmatch(namespace):
        raise IdempotencyError("namespace must be a short lowercase slug")
    parts = [
        namespace,
        authorization_record_reference.strip(),
        source_platform.strip(),
        source_claim_id.strip(),
        source_version.strip(),
        contract_version.strip(),
        (recheck_token or "").strip(),
    ]
    for required in parts[1:6]:
        if not required:
            raise IdempotencyError(
                "authorization_record_reference, source_platform, source_claim_id, "
                "source_version and contract_version are all required"
            )
    payload = "\x1f".join(parts).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:32]
    key = f"{namespace}:{digest}"
    if len(key) > MAX_KEY_LENGTH:
        raise IdempotencyError("derived key exceeds the CALL-E 255 character limit")
    return key
