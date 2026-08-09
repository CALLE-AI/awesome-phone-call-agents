"""Shared validation, kept in `core` (not `transports`) so both the
registry loader and the transports can depend on it without creating a
`core -> transports` import direction.
"""

from __future__ import annotations

import hashlib
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Same pattern CALL-E's own OpenAPI spec uses for CallTaskRecipientRequest.phones.
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def validate_e164(phone: str) -> None:
    if not E164_RE.match(phone):
        raise ValueError(f"Phone number is not valid E.164: {phone!r}")


def validate_timezone(tz: str) -> None:
    """Real calls must carry an explicit, real recipient timezone. Without
    this validated at every entry point that constructs a Candidate --
    including the registry CSV loader, not just the CLI/MCP real-call
    paths -- Candidate.timezone can silently hold an invalid string, and
    the governance module's calling-hours check falls back to UTC rather
    than rejecting it, exactly as if the check didn't exist."""
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError:
        raise ValueError(f"Not a recognized IANA timezone name: {tz!r}") from None


def stable_id_from_phone(phone: str) -> str:
    """A candidate id derived from the phone number itself, not list
    position. Governance (do-not-call, cooldown, contact fatigue) and
    ledger idempotency are both keyed by candidate.id -- a positional id
    like f"real_{i}" means reordering the same input list reassigns one
    person's history to another, and two entries for the same phone number
    (a duplicate, e.g. a copy-paste mistake) get two independent ids and
    get dialed twice. Deriving the id from the phone number itself makes it
    stable across reordering and makes duplicate phones naturally collide
    on the same id, so they're caught explicitly (see the duplicate-phone
    checks in registry.py and the CLI/MCP entry points) rather than
    silently dialed as if they were different people.
    """
    return f"c_{hashlib.sha256(phone.encode('utf-8')).hexdigest()[:16]}"


def mask_phone(phone: str) -> str:
    """Shared with the dashboard's own masking so every operator-facing
    surface -- CLI output, MCP tool responses/previews/errors, the web UI
    -- redacts real phone numbers consistently rather than each surface
    reinventing (or forgetting) its own masking."""
    if len(phone) <= 4:
        return phone
    stars = max(1, len(phone) - 6)
    return phone[:3] + "*" * stars + phone[-3:]
