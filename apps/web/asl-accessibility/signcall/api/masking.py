"""
Masks phone numbers in everything the API hands out: run results, proposals,
the plan, errors and notification events. The server keeps the raw numbers in
memory because it needs them to place calls and to cancel; they never leave
the process. Only the last four digits are kept, e.g. "+1******4605", so a
person can still match a number they know.
"""

from __future__ import annotations

import re

# E.164 as the workflow stores it, plus the common US written forms that can
# appear in call notes, e.g. "(702) 555-0123" or "702-555-0123".
_PHONE = re.compile(r"\+\d{7,15}|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b")


def _mask_match(match: re.Match) -> str:
    text = match.group(0)
    digits = re.sub(r"\D", "", text)
    prefix = "+" if text.startswith("+") else ""
    return prefix + "*" * (len(digits) - 4) + digits[-4:]


def mask_text(text: str) -> str:
    return _PHONE.sub(_mask_match, text)


def mask(value):
    """A copy of `value` with every phone number in every string masked."""
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, dict):
        return {key: mask(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [mask(item) for item in value]
    return value
