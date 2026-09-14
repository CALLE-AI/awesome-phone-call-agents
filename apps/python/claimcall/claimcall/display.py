"""Display-only phone masking; private request and result data stay unchanged."""
from __future__ import annotations

import re
from typing import Any

PHONE = re.compile(
    r"\+[1-9][0-9]{6,14}\b|\+[1-9][0-9]{0,2}(?:[ ().-]+[0-9]{1,4}){2,5}"
    r"|\([2-9][0-9]{2}\)[ .-]?[0-9]{3}[ .-]?[0-9]{4}\b"
    r"|\b[2-9][0-9]{2}[ .-][0-9]{3}[ .-][0-9]{4}\b|\b[2-9][0-9]{9}\b"
)


def mask_output_text(value: str) -> str:
    def replace(match: re.Match) -> str:
        digits = re.sub(r"[^0-9]", "", match.group())
        return f"[phone …{digits[-4:]}]" if 7 <= len(digits) <= 15 else match.group()
    return PHONE.sub(replace, value)


def mask_output(value: Any) -> Any:
    if isinstance(value, str):
        return mask_output_text(value)
    if isinstance(value, list):
        return [mask_output(item) for item in value]
    if isinstance(value, dict):
        return {key: mask_output(item) for key, item in value.items()}
    return value
