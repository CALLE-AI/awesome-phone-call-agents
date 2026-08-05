"""PII redaction and untrusted display-name handling for MetaPelet check-in."""

from __future__ import annotations

import re
from typing import Any

CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
WHITESPACE_RE = re.compile(r"\s+")
DISPLAY_NAME_RE = re.compile(r"^[\w\s\-'.]+$", re.UNICODE)
INJECTION_HINT_RE = re.compile(
    r"(?i)\b(ignore|disregard|override|system prompt|instructions|you must|do not follow)\b"
)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
SPACED_PHONE_RE = re.compile(
    r"(?<!\w)(?:\+?(?:\d[\s().-]?){7,15}\d|\(\d{3}\)\s*\d{3}[\s.-]?\d{4})(?!\w)"
)
CONTIGUOUS_PHONE_RE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
API_SECRET_RE = re.compile(
    r"(?i)\b(iams_live_[a-z0-9_]{16,}|calle_live_[a-z0-9_]{16,}|sk-[a-zA-Z0-9]{16,})\b"
)
SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
LONG_ALNUM_ID_RE = re.compile(r"\b[A-Z0-9]{12,}\b")
STREET_ADDRESS_RE = re.compile(
    r"\b\d{1,5}\s+[A-Za-z0-9.'-]+\s+"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\b",
    re.IGNORECASE,
)


def sanitize_display_name(raw: str) -> str:
    """Validate caller-supplied recipient name for prompt embedding."""
    if raw is None:
        raise ValueError("user_name is required")
    if "\n" in raw or "\r" in raw or "\t" in raw:
        raise ValueError("user_name must not contain line breaks or tabs")
    cleaned = CONTROL_CHARS_RE.sub("", str(raw).strip())
    cleaned = WHITESPACE_RE.sub(" ", cleaned)
    if not cleaned:
        raise ValueError("user_name is required")
    if len(cleaned) > 64:
        raise ValueError("user_name must be at most 64 characters")
    if not DISPLAY_NAME_RE.fullmatch(cleaned):
        raise ValueError(
            "user_name may contain only letters, numbers, spaces, hyphen, apostrophe, or period"
        )
    if INJECTION_HINT_RE.search(cleaned):
        raise ValueError("user_name contains disallowed instruction-like text")
    return cleaned


def embed_recipient_name(display_name: str) -> str:
    """Wrap name for prompt insertion; content is treated as data, not instructions."""
    safe = (
        display_name.replace("\\", "\\\\")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )
    return f"[RECIPIENT_NAME]{safe}[/RECIPIENT_NAME]"


def redact_pii_string(text: str) -> str:
    redacted = str(text or "")
    redacted = API_SECRET_RE.sub("[secret-redacted]", redacted)
    redacted = EMAIL_RE.sub("[email-redacted]", redacted)
    redacted = SSN_RE.sub("[id-redacted]", redacted)
    redacted = STREET_ADDRESS_RE.sub("[address-redacted]", redacted)
    redacted = SPACED_PHONE_RE.sub("[phone-redacted]", redacted)
    redacted = CONTIGUOUS_PHONE_RE.sub("[phone-redacted]", redacted)
    redacted = LONG_ALNUM_ID_RE.sub("[id-redacted]", redacted)
    return redacted


def redact_sensitive_text(value: Any) -> Any:
    if isinstance(value, str):
        return redact_pii_string(value)
    if isinstance(value, list):
        return [redact_sensitive_text(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_sensitive_text(item) for key, item in value.items()}
    return value
