"""Small safety helpers shared across the app: strict E.164 validation, an
optional authorized-destination allowlist, and phone-number masking for every
user-facing or logged value.
"""

from __future__ import annotations

import json
import os
import re

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def safe_json(obj) -> str:
    """Serialize for embedding inside an inline <script>. json.dumps does NOT
    escape '</script>' or '<', and callers embed provider/LLM-derived strings
    (names, fact text, summaries) — so escape '<' and the U+2028/2029 line
    separators to prevent breaking out of the script tag."""
    return (json.dumps(obj).replace("<", "\\u003c")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def plain(s: str, n: int = 160) -> str:
    """Strip angle brackets from a string used as a vis-network tooltip (`title`),
    which some builds render via innerHTML — so no HTML/JS can ride along."""
    return re.sub(r"[<>]", "", (s or ""))[:n]


def is_e164(num: str) -> bool:
    """True only for a strict E.164 number: '+' then 8–15 digits, no leading 0."""
    return bool(_E164.match((num or "").strip()))


def allowed_destinations() -> list[str]:
    """Parsed `CORTEX_ALLOWED_DIAL` — comma-separated **exact, strictly valid
    E.164 numbers**. Any entry that is not a valid E.164 number is discarded, so
    a broad value (e.g. a bare prefix like `+1`) cannot authorize anything."""
    raw = [a.strip() for a in os.environ.get("CORTEX_ALLOWED_DIAL", "").split(",") if a.strip()]
    return [a for a in raw if is_e164(a)]


def authorized_dial(num: str, *, require_allowlist: bool = False) -> bool:
    """Gate a destination against the allowlist by **exact match only** (no
    prefixes).

    With `require_allowlist=True` (the live-dial path) an **empty allowlist fails
    closed** — you must list the exact numbers you are authorized to call. With
    the default `False` (validation only) an empty allowlist permits any valid
    E.164 number."""
    allow = allowed_destinations()
    if not allow:
        return not require_allowlist
    return (num or "").strip() in set(allow)


def mask_phone(num: str) -> str:
    """Mask a phone number for display/logs: keep the country prefix and last two
    digits, hide the middle (e.g. '+12025550123' -> '+12•••••••23')."""
    s = (num or "").strip()
    if not s:
        return "—"
    if len(s) <= 5:
        return s[0] + "•" * (len(s) - 1)
    return s[:3] + "•" * (len(s) - 5) + s[-2:]
