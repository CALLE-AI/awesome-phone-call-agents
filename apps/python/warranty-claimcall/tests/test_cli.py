"""The CLI surface itself: exit codes and the promises in the README."""

from __future__ import annotations

import pytest
from claimcall.cli import main

from .conftest import fixture_path


def test_preview_exits_zero_and_shows_the_plan(capsys: pytest.CaptureFixture):
    assert main(["preview", "--claim", fixture_path("eligible-claim.json")]) == 0
    out = capsys.readouterr().out
    assert "Safety gate: PASS" in out
    assert "Plan hash:" in out
    assert "+15005550006" not in out


def test_preview_json_is_machine_readable(capsys: pytest.CaptureFixture):
    import json

    main(["preview", "--claim", fixture_path("eligible-claim.json"), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert payload["safety"]["decision"] == "pass"
    assert payload["manifest"]["recipient_number_e164"] != "+15005550006"


def test_an_unsafe_claim_file_exits_held(capsys: pytest.CaptureFixture):
    assert main(["preview", "--claim", fixture_path("unsafe-claim.json")]) == 2
    assert "REJECT" in capsys.readouterr().out


def test_run_defaults_to_a_dry_run(capsys: pytest.CaptureFixture):
    assert main(["run", "--claim", fixture_path("eligible-claim.json")]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "VERIFIED" in out


def test_live_without_confirm_is_refused(capsys: pytest.CaptureFixture):
    code = main(["run", "--claim", fixture_path("eligible-claim.json"), "--live"])
    assert code == 2
    assert "--confirm does not match" in capsys.readouterr().err


def test_live_with_a_stale_hash_is_refused(capsys: pytest.CaptureFixture):
    code = main(
        ["run", "--claim", fixture_path("eligible-claim.json"), "--live", "--confirm", "0" * 64]
    )
    assert code == 2
    assert "Refusing to place a live call" in capsys.readouterr().err


def test_verify_replays_a_saved_result(capsys: pytest.CaptureFixture):
    code = main(
        [
            "verify",
            "--claim", fixture_path("eligible-claim.json"),
            "--result", fixture_path("no-answer-result.json"),
        ]
    )
    assert code == 2  # inconclusive is not a success
    assert "INCONCLUSIVE" in capsys.readouterr().out


def test_show_task_prints_the_agent_instructions(capsys: pytest.CaptureFixture):
    assert main(["show-task", "--claim", fixture_path("eligible-claim.json")]) == 0
    assert "IDENTITY AND DISCLOSURE" in capsys.readouterr().out


def test_hash_number_helps_build_an_allowlist(capsys: pytest.CaptureFixture):
    assert main(["hash-number", "+15005550006"]) == 0
    digest = capsys.readouterr().out.strip()
    assert len(digest) == 64 and "+" not in digest
