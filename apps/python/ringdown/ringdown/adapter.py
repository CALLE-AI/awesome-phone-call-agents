from __future__ import annotations

import re
from typing import Any, Mapping

MISSING = object()
TOKEN = re.compile(r"\.([^.\[\]]+)|\[(\d+)\]")


def resolve(payload: Any, path: str) -> Any:
    if not path.startswith("$"):
        return MISSING
    cursor = 1
    current: Any = payload
    while cursor < len(path):
        found = TOKEN.match(path, cursor)
        if found is None:
            return MISSING
        cursor = found.end()
        key, index = found.groups()
        if key is not None:
            if not isinstance(current, Mapping) or key not in current:
                return MISSING
            current = current[key]
            continue
        position = int(index)
        if not isinstance(current, list) or position >= len(current):
            return MISSING
        current = current[position]
    return current


def adapt(payload: Any, mapping: Mapping[str, Any]) -> dict[str, Any]:
    adapted: dict[str, Any] = {}
    for field, spec in mapping.items():
        if not isinstance(spec, str) or not spec.startswith("$"):
            adapted[field] = spec
            continue
        value = resolve(payload, spec)
        if value is not MISSING:
            adapted[field] = value
    return adapted
