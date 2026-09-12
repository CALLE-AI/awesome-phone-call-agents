"""Small, deterministic privacy filters applied before any free text is persisted."""

from __future__ import annotations

import re


def redact_pii(text: str) -> str:
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[EMAIL REDACTED]", text)
    return re.sub(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)", "[PHONE REDACTED]", text)
