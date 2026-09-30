#!/usr/bin/env python3
"""Content-derived idempotency key for one logical batch of call attempts.

    python idempotency_key.py wr_1:1 wr_2:1 wr_3:1

The key is a function of batch membership only, so:

* retrying the same logical batch after a timeout produces a byte-identical
  key, and CALL-E returns the original call instead of dialling anyone twice;
* reordering the members does not change it;
* changing the members does.

Never derive this from a clock, a UUID, or a retry counter. A create that
timed out may already have started a phone call, and a fresh key on the
retry calls a real person a second time.
"""

from __future__ import annotations

import hashlib
import sys

MAX_KEY_LENGTH = 255  # provider limit on the Idempotency-Key header


def batch_idempotency_key(attempt_ids: list[str], prefix: str = "wf:batch") -> str:
    """Derive a stable key from ``{workflow_run_id}:{attempt_no}`` pairs."""
    if not attempt_ids:
        raise ValueError("cannot derive a key for an empty batch")
    digest = hashlib.sha256("|".join(sorted(attempt_ids)).encode()).hexdigest()[:32]
    key = f"{prefix}:{digest}"
    assert len(key) <= MAX_KEY_LENGTH
    return key


if __name__ == "__main__":
    members = sys.argv[1:] or ["wr_1:1", "wr_2:1", "wr_3:1"]
    key = batch_idempotency_key(members)
    print(f"members : {sorted(members)}")
    print(f"key     : {key}  ({len(key)} chars)")
    print(f"stable  : {key == batch_idempotency_key(list(reversed(members)))}")
