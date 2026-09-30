from __future__ import annotations

import re

E164_IN_TEXT = re.compile(r"(?<![0-9])\+[1-9][0-9]{7,14}(?![0-9])")
PHONE_LIKE_RE = re.compile(
    r"(?<![A-Za-z0-9])\+?[0-9][0-9\s().-]{6,}[0-9](?![A-Za-z0-9])"
)


def mask_phone(phone: str) -> str:
    if not isinstance(phone, str) or not phone.strip():
        return "[redacted]"
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 8:
        return "[redacted]"
    prefix = phone[:3] if phone.startswith("+") else phone[:2]
    return f"{prefix}*****{digits[-4:]}"


def _mask_phone_like(match: re.Match[str]) -> str:
    raw = match.group(0)
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) < 8:
        return raw
    if raw.strip().startswith("+"):
        return mask_phone("+" + digits)
    return mask_phone(digits)


def redact_text(value: str | None) -> str:
    if not value:
        return ""
    text = E164_IN_TEXT.sub(lambda match: mask_phone(match.group(0)), value)
    return PHONE_LIKE_RE.sub(_mask_phone_like, text)


def redact_clinical(value: str | None) -> str | None:
    if value is None:
        return None
    return redact_text(value)
