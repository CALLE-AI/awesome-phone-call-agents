from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "fictional_hkg_kul_journey.json"


def raw_case() -> dict[str, Any]:
    return copy.deepcopy(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def completed_result(**changes: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schemaVersion": "1.0",
        "contactOutcome": "REACHED",
        "roleMatch": "YES",
        "propositions": {"P1": "CONFIRMED", "P2": "CONFIRMED", "P3": "CONFIRMED"},
        "writtenReference": "OFFERED",
        "commitmentRequested": "NO",
    }
    value.update(changes)
    return value
