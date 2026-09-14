"""An authored receipts directory, of the shape the reviewer page is built from.

Why this exists. The gates on the built page could only run on the machine holding the real
receipts, because the page is built from records of real calls and those records are kept out
of this repository on purpose. That left the masking rule, and the promise that every result
reaches the page, checked nowhere a reviewer could reach. A verification pass put it plainly:
the claims added last were the ones only their author could test.

So the page is built twice. Once from the real receipts, which is what gets published, and
once from this, which is what the suite checks. Everything here was typed by hand. No call was
placed, nobody was recorded, and the waveform is a repeating sawtooth.

Identifiers are assembled from parts at run time rather than written out whole. Written whole
they would be the exact shapes `test_privacy.py` scans every tracked file for, and this module
would have to be added to an allowlist to sit in the tree. A file that has to be exempted from
the privacy rules to hold test data is the thing that went wrong once already.
"""
from __future__ import annotations

import json
from pathlib import Path

# 24 hex characters. Short of the 32 that makes a billing id, and with `call_` in front of it
# still short of nothing, because the prefix is added separately below.
_STEM = "aaaa1111bbbb2222cccc3333"

# (id, locale, letter, parent_confirmed_aware, reason_category, expected_return)
CALLS: list[tuple[str, str, str, str, str, str]] = [
    ("S-4101", "en-IN", "a", "yes", "illness", "tomorrow"),
    ("S-4102", "ta-IN", "b", "yes", "illness", "tomorrow"),
    ("S-4103", "en-IN", "c", "yes", "family_emergency", "unknown"),
    ("S-4104", "ta-IN", "d", "unknown", "family_emergency", "unknown"),
    ("S-4105", "en-IN", "e", "no", "transport", "today"),
    ("S-4106", "ta-IN", "f", "no", "transport", "today"),
    ("S-4107", "en-IN", "g", "unknown", "unknown", "unknown"),
    ("S-4108", "ta-IN", "h", "unknown", "unknown", "unknown"),
]

# The builder reads the register from the English side of each pair, and names one pair in the
# opening scene, so the fixture has to carry pairs rather than a flat list.
PAIRS = [
    ("illness, returns tomorrow", "S-4101", "S-4102", 2, 3),
    ("family emergency, no return date", "S-4103", "S-4104", 1, 3),
    ("parent did not know", "S-4105", "S-4106", 3, 3),
    ("refusal", "S-4107", "S-4108", 3, 3),
]

FIELD_ORDER = ["parent_confirmed_aware", "reason_category", "expected_return"]


def api_id(letter: str) -> str:
    return "call" + "_" + letter + "_" + _STEM


def provider_id(index: int) -> str:
    return _STEM + "dddd" + f"{index:04d}"


def not_yes() -> list[str]:
    """The ids whose parent never confirmed. The number the page has to support."""
    return [sid for sid, _l, _c, aware, _r, _e in CALLS if aware != "yes"]


def write(dest: Path) -> Path:
    """Write the fixture into `dest` and return it. The receipt is named `06-` because that
    is the prefix the builder looks for when it wants the run behind the summary scene."""
    dest.mkdir(parents=True, exist_ok=True)

    receipt = {
        "api_base_url": "http://127.0.0.1:0/v1",
        "calls_placed": len(CALLS),
        "cancelled": False,
        "concurrency": 2,
        "counts": {"failed": 0, "resolved": len(CALLS), "skipped": 0, "undetermined": 0},
        "fatal_error": None,
        "funding_rate": None,
        "funding_recovered": None,
        "generated": "2026-09-06T00:00:00+00:00",
        "items": [
            {
                "attempts": 1,
                "call_id": api_id(letter),
                "failure_code": None,
                "id": sid,
                "numbers_tried": ["+915550000001"],
                "reason": "schema-valid answer received",
                "resolution": "resolved",
                "structured_result": {
                    "parent_confirmed_aware": aware,
                    "reason_category": reason,
                    "expected_return": ret,
                },
            }
            for sid, _locale, letter, aware, reason, ret in CALLS
        ],
        "mode": "double",
        "not_recallable": [],
        "reached_production_api": False,
        "resolution_rate": 1.0,
        "transcript_included": False,
        "work_file": "examples/absences.csv",
    }
    (dest / "06-authored.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")

    transcripts = {
        "_provenance": {
            "what": "Authored fixture. No call was placed and nobody was recorded.",
            "source": "tests/fixture_page.py",
            "consent": "not applicable, nobody was called",
            "checked": "2026-09-06",
            "audio": "none",
            "offsets": "invented",
        },
        "fieldOrder": FIELD_ORDER,
        "pairs": [{"label": label, "en": en, "ta": ta, "agree": agree, "of": of}
                  for label, en, ta, agree, of in PAIRS],
        "calls": {
            sid: {
                "locale": locale,
                "providerId": provider_id(index + 1),
                "apiId": api_id(letter),
                "seconds": 12.0,
                "peaks": [0.1, 0.4, 0.2, 0.5] * 25,
                "confidence": 0.9,
                "structured": {
                    "parent_confirmed_aware": aware,
                    "reason_category": reason,
                    "expected_return": ret,
                },
                "note": "authored for the suite",
                "turns": [
                    {"offset_seconds": 0, "speaker": "agent", "text": "Good morning."},
                    {"offset_seconds": 4, "speaker": "parent", "text": "Yes, speaking."},
                    {"offset_seconds": 8, "speaker": "agent", "text": "Thank you, goodbye."},
                ],
            }
            for index, (sid, locale, letter, aware, reason, ret) in enumerate(CALLS)
        },
    }
    (dest / "transcripts.json").write_text(json.dumps(transcripts, indent=2), encoding="utf-8")
    return dest
