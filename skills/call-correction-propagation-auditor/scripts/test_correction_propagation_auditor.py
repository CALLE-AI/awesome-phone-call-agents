#!/usr/bin/env python3
"""Tests for call-correction-propagation-auditor (pytest + standalone runner)."""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

import correction_propagation_auditor as mod

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "correction_propagation_auditor.py"


def _turn(spk, txt):
    return {"speaker": spk, "text": txt}


# ---------------------------------------------------------------------------
# Parser / masking / CLI trio
# ---------------------------------------------------------------------------

def test_mask_keeps_short_runs():
    text = "Party of 4 on 10/14 at 7 p.m., 2026."
    assert mod.mask_pii(text) == text


def test_mask_masks_7plus_digit_runs_keep_last_2():
    assert mod.mask_pii("+14155550151") == "+#########51"
    assert mod.mask_pii("call 415-555-0151 now") == "call ##########51 now"


def test_load_nested_wrapped_shape():
    p = _write_json("wrapped.json", {
        "call_id": "w-1", "status": "COMPLETED",
        "result": {
            "post_summary": "Booked for Thursday.",
            "transcript": [{"speaker": "agent", "text": "Hi."}],
        },
    })
    rec = mod.load_call_result(p)
    assert rec["call_id"] == "w-1"
    assert rec["post_summary"] == "Booked for Thursday."
    assert rec["turns"] == [{"speaker": "agent", "text": "Hi."}]


def test_load_flat_shape():
    p = _write_json("flat.json", {
        "call_id": "f-1",
        "post_summary": "Booked.",
        "transcript": [{"speaker": "callee", "text": "Okay."}],
    })
    rec = mod.load_call_result(p)
    assert rec["call_id"] == "f-1" and rec["post_summary"] == "Booked."
    assert rec["turns"] == [{"speaker": "callee", "text": "Okay."}]


def test_load_string_transcript():
    p = _write_json("str.json", {"call_id": "s-1", "post_summary": "", "transcript": "One line."})
    rec = mod.load_call_result(p)
    assert rec["turns"] == [{"speaker": "agent", "text": "One line."}]


def test_load_mixed_list_skips_non_dicts_and_defaults_text():
    p = _write_json("mixed.json", {
        "post_summary": "x",
        "transcript": [{"speaker": "agent", "text": "Hi."}, 5, "junk", {"speaker": "agent"}],
    })
    rec = mod.load_call_result(p)
    assert rec["turns"] == [
        {"speaker": "agent", "text": "Hi."},
        {"speaker": "agent", "text": ""},
    ]


def test_cli_invalid_json_array_exits_2_with_error():
    p = _write_json("arr.json", [1, 2, 3])
    proc = _run_cli(["analyze", "--call-result", str(p)])
    assert proc.returncode == 2
    assert "error" in proc.stderr


def test_cli_missing_call_result_exits_2():
    with pytest.raises(SystemExit) as exc:
        mod.main(["analyze"])
    assert exc.value.code == 2


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_TMP: Path | None = None


def _tmp_dir() -> Path:
    # System temp, outside the repo; removed at process exit so the working
    # tree stays clean after a full run.
    global _TMP
    if _TMP is None:
        _TMP = Path(tempfile.mkdtemp(prefix="ccpa-tests-"))
        atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
    return _TMP


def _write_json(name: str, payload) -> Path:
    p = _tmp_dir() / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _run_cli(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *argv],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _run_all():
    failures = 0
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
