import json
import subprocess
import sys
from pathlib import Path

import judge_bundle
import judge_proof


APP_ROOT = Path(__file__).resolve().parent


def test_committed_judge_bundle_is_exact_engine_output():
    committed = json.loads((APP_ROOT / "judge_bundle.json").read_text(encoding="utf-8"))

    assert committed == judge_bundle.generate_bundle()
    assert committed["generated_by"] == "judge_bundle.py -> rescue.run_rescue"
    assert committed["creates_phone_calls"] is False


def test_judge_proof_verifies_attribution_and_fail_closed_behavior():
    proof = judge_proof.verify()

    assert proof["verdict"] == "PASS"
    assert proof["engine_artifact_exact_match"] is True
    assert proof["phone_calls_created"] == 0
    assert proof["automatic_bookings"] == 0
    assert proof["automatic_redials"] == 0
    assert proof["labor_only_break_even_at_35_eur_per_hour"] > 0


def test_judge_proof_runs_with_standard_library_only():
    result = subprocess.run(
        [sys.executable, "judge_proof.py"],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=20,
    )

    assert result.returncode == 0, result.stderr
    assert "verdict: PASS" in result.stdout
    assert "phone_calls_created: 0" in result.stdout
