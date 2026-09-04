"""Tests for the judge-facing command.

The behaviours locked here are the ones that would embarrass us if they broke: the
default never dials, a money figure never appears without a source, live mode never
starts by accident, and no raw phone number ever reaches the receipt.
"""

from __future__ import annotations

import json
import re

import pytest

from firstbell.cli import main

WORK = "examples/absences.csv"


def test_the_default_run_needs_no_account_and_places_no_call(capsys):
    assert main(["--work-file", WORK]) == 0
    out = capsys.readouterr().out
    assert "OFFLINE" in out
    assert "no telephone call was placed" in out


def test_the_demo_run_shows_all_three_outcomes(capsys):
    """A run where everything succeeds hides the outcome the product exists for."""
    main(["--work-file", WORK])
    out = capsys.readouterr().out
    assert "resolved             3" in out
    assert "undetermined         1" in out
    assert "failed               1" in out
    assert "skipped, no consent  1" in out
    assert "2 case(s) need a person" in out


def test_it_is_deterministic(capsys):
    main(["--work-file", WORK])
    first = capsys.readouterr().out
    main(["--work-file", WORK])
    assert capsys.readouterr().out == first


def test_a_money_figure_requires_a_source():
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--funding-rate", "12.5"])
    assert "without a citation" in str(caught.value)


def test_a_sourced_rate_is_computed_from_resolved_only(capsys):
    main(["--work-file", WORK, "--funding-rate", "10",
          "--funding-jurisdiction", "Example", "--funding-source", "Example Dept",
          "--funding-url", "https://example.org/x"])
    out = capsys.readouterr().out
    # 3 resolved x 10. The undetermined and failed rows recover nothing, because the
    # record is still open and a person still has to work it.
    assert "$30.00" in out
    assert "3 resolved x $10.00" in out
    assert "https://example.org/x" in out


def test_live_refuses_to_start_without_an_explicit_confirmation():
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--live"])
    assert "--yes-i-mean-it" in str(caught.value)


def test_live_refuses_without_an_api_key(monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    with pytest.raises(SystemExit) as caught:
        main(["--work-file", WORK, "--live", "--yes-i-mean-it"])
    assert "CALLE_API_KEY" in str(caught.value)


def test_the_receipt_records_the_mode_and_masks_every_number(tmp_path):
    receipt = tmp_path / "receipt.json"
    main(["--work-file", WORK, "--receipt", str(receipt)])
    data = json.loads(receipt.read_text(encoding="utf-8"))

    assert data["mode"] == "offline", "a receipt that hid the mode would be worthless"
    assert data["counts"]["resolved"] == 3
    unmasked = [m for m in re.findall(r"\+\d{8,15}", json.dumps(data)) if "*" not in m]
    assert unmasked == [], f"raw numbers reached the receipt: {unmasked}"


def test_a_work_file_without_consent_is_refused(tmp_path, capsys):
    path = tmp_path / "bad.csv"
    path.write_text("id,phones\nS-1,+915550000001\n", encoding="utf-8")
    assert main(["--work-file", str(path)]) == 2
    assert "consent" in capsys.readouterr().err


def test_the_ai_disclosure_opens_every_task():
    from firstbell import AI_DISCLOSURE, build_task
    from dispatch import WorkItem

    task = build_task(WorkItem(id="S-1", phones=("+915550000001",),
                               context={"student_name": "Anitha"}))
    assert task.startswith(AI_DISCLOSURE)
    assert "AI assistant, not a person" in task
    # The remit is narrow on purpose.
    assert "Do not give advice" in task
    assert "member of staff will call back" in task


# -- what "live" is allowed to mean -----------------------------------------

def test_the_word_live_is_reserved_for_the_host_that_can_ring_a_phone():
    """--live is not evidence. The base URL is.

    The SDK takes a base_url, so the real client over real HTTP can still be talking to a
    double. If the receipt called that "live", the receipt would be manufacturing evidence
    of a phone call that never happened.
    """
    from firstbell.cli import PRODUCTION_HOST, RunMode

    offline = RunMode(live=False)
    double = RunMode(live=True, base_url="http://127.0.0.1:8787")
    real = RunMode(live=True, base_url=f"https://{PRODUCTION_HOST}")

    assert (offline.label, double.label, real.label) == (
        "offline", "live-nonproduction", "live")
    assert [m.reached_production for m in (offline, double, real)] == [False, False, True]
    assert "No phone will ring" in double.banner()
    assert "real credits" in real.banner()
    # A near miss must not pass for the real thing.
    assert not RunMode(True, "https://api.heycall-e.com.example.net").reached_production


def test_a_live_run_against_a_double_says_so_in_the_receipt(tmp_path, monkeypatch):
    """End to end through the --live branch, so that branch is not dead code."""
    import socket
    from calle_double.server import serve

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = serve(port=port)
    receipt = tmp_path / "live.json"
    try:
        monkeypatch.setenv("CALLE_API_KEY", "iams_test_anything")
        monkeypatch.setenv("CALLE_BASE_URL", f"http://127.0.0.1:{port}")
        assert main(["--work-file", WORK, "--live", "--yes-i-mean-it",
                     "--limit", "2", "--receipt", str(receipt)]) == 0
    finally:
        server.shutdown()

    data = json.loads(receipt.read_text(encoding="utf-8"))
    assert data["mode"] == "live-nonproduction"
    assert data["reached_production_api"] is False
    assert data["api_base_url"] == f"http://127.0.0.1:{port}"
    assert len(data["items"]) == 2, "the live branch really did run the pipeline"


def test_the_transcript_stays_out_of_the_receipt_unless_it_is_asked_for(tmp_path):
    """What a parent said is private by default.

    The repository's pull-request checklist forbids committing private transcripts, and a
    default that quietly wrote them would put every user one `--receipt` away from
    breaking it.
    """
    without = tmp_path / "a.json"
    main(["--work-file", WORK, "--receipt", str(without)])
    plain = json.loads(without.read_text(encoding="utf-8"))
    assert plain["transcript_included"] is False
    assert all("transcript" not in item for item in plain["items"])
    assert "kaaichal" not in json.dumps(plain).lower(), "spoken words leaked into a receipt"

    withit = tmp_path / "b.json"
    main(["--work-file", WORK, "--receipt", str(withit), "--include-transcript"])
    full = json.loads(withit.read_text(encoding="utf-8"))
    assert full["transcript_included"] is True
    spoken = [t for item in full["items"] for t in item.get("transcript", ())]
    assert any(turn["speaker"] == "user" for turn in spoken)
    assert "kaaichal" in json.dumps(full).lower(), "asked for the transcript and got none"
    # Consent is not retroactive: a number is still masked either way.
    unmasked = [m for m in re.findall(r"\+\d{8,15}", json.dumps(full)) if "*" not in m]
    assert unmasked == []
