"""Bounded phone masking for displayed and derived results, never call inputs."""

import re
from typing import Any


PHONE = re.compile(r"(?<!\w)\+?[0-9](?:[\s().-]*[0-9]){7,14}(?!\w)")


def mask_text(value: str) -> str:
    return PHONE.sub(lambda match: "[phone ending " + re.sub(r"\D", "", match[0])[-2:] + "]", value)


def public_value(value: Any) -> Any:
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, dict):
        return {key: public_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [public_value(item) for item in value]
    return value
