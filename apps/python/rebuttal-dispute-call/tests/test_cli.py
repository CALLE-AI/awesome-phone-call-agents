"""The command line: every dry-run scenario, the preview, and a live command that refuses before any request.

Each test passes an explicit environment, so a developer's own .env or shell variables never leak
in. The network is disabled throughout, and the calle-ai package is replaced by a stand-in that
records every client the command builds.
"""
import socket
import sys
import types
from datetime import datetime

import pytest

from rebuttal_dispute_call import cli
from rebuttal_dispute_call.fake import SCENARIOS, FakeCalle

PHONE = "+12125550101"
NOON_NY = datetime.fromisoformat("2026-09-15T16:00:00+00:00")
READY = {"CALLE_API_KEY": "test-key-not-real", "REBUTTAL_CALL_ALLOWLIST": PHONE}
LIVE = ["live", "--to", PHONE, "--i-have-consent"]
DECISIONS = {
    "grounded": "would be filed as customer communication",
    "ungrounded": "would not be filed",
    "no-disclosure": "would not be filed",
    "denied": "stops the filing",
    "declined": "would not be filed",
    "no-answer": "would not be filed",
}


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # ./out/ lands in a temporary directory

    def refuse(*args, **kwargs):
        raise AssertionError("the network was touched")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture
def sdk(monkeypatch):
    """A stand-in for the calle-ai package. Its client answers from the fake."""
    built = []

    class CalleClient:
        def __init__(self, **kwargs):
            built.append(kwargs)
            self.calls = FakeCalle("grounded").calls

        def close(self):
            pass

    module = types.ModuleType("calle")
    module.CalleClient = CalleClient
    monkeypatch.setitem(sys.modules, "calle", module)
    return built


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_every_dry_run_scenario_exits_zero_and_writes_evidence(scenario, capsys, sdk, tmp_path):
    assert cli.main(["dry-run", "--scenario", scenario], environ={}, now=NOON_NY) == 0
    out = capsys.readouterr().out
    assert f"decision         {DECISIONS[scenario]}" in out
    assert (tmp_path / "out" / "dry-run" / f"du_demo_1042-{scenario}.pdf").read_bytes()[:5] == b"%PDF-"
    assert out.isascii() and "+12*****0101" in out and "2125550101" not in out
    assert sdk == [], "a dry run never builds a CALL-E client"


def test_dry_run_is_the_default(capsys):
    assert cli.main([], environ={}, now=NOON_NY) == 0
    assert "dry run: a local fake CALL-E answers (scenario grounded)" in capsys.readouterr().out
    assert cli.main(["--scenario", "denied"], environ={}, now=NOON_NY) == 0
    assert "stops the filing" in capsys.readouterr().out


def test_preview_places_no_call(capsys, sdk, tmp_path):
    assert cli.main(["preview"], environ={"REBUTTAL_CALL_ALLOWLIST": PHONE}, now=NOON_NY) == 0
    out = capsys.readouterr().out
    assert "no call placed" in out and "rebuttal-confirm-receipt-v2-du_demo_1042" in out
    assert "BLOCK  CALL_WITHOUT_OPERATOR_INTENT" in out and "PASS   destination in allowlist" in out
    assert sdk == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("argv,environ,reason", [
    (["live", "--to", PHONE], READY, "CALL_WITHOUT_OPERATOR_INTENT"),
    (LIVE, {"CALLE_API_KEY": "test-key-not-real"}, "CALL_DESTINATION_NOT_AUTHORIZED"),
    (LIVE, {"REBUTTAL_CALL_ALLOWLIST": PHONE}, "CALLE_API_KEY is not set"),
    (LIVE, dict(READY, CALLE_BASE_URL="https://calls.example.net"), "CALLE_BASE_URL must be"),
    (LIVE, dict(READY, CALLE_BASE_URL="http://api.heycall-e.com"), "CALLE_BASE_URL must be"),
    (["live", "--to", "2125550101", "--i-have-consent"], READY, "CALL_DESTINATION_NOT_E164"),
    (LIVE + ["--on-record", "+12125550102"], READY, "CALL_NUMBER_NOT_ON_RECORD"),
])
def test_live_refuses_before_any_request(argv, environ, reason, capsys, sdk):
    assert cli.main(argv, environ=environ, now=NOON_NY) == 2
    out = capsys.readouterr().out
    assert "Not calling:" in out and reason in out
    assert "cannot be cancelled through the public CALL-E API" in out
    assert "test-key-not-real" not in out
    assert sdk == [], "no CALL-E client was built, so no request was sent"


def test_live_refuses_outside_local_calling_hours(capsys, sdk):
    late = datetime.fromisoformat("2026-09-15T03:00:00+00:00")
    assert cli.main(LIVE, environ=READY, now=late) == 2
    assert "CALL_OUTSIDE_LOCAL_HOURS: 23:00 in America/New_York is outside 08:00-21:00" in capsys.readouterr().out
    assert sdk == []


def test_live_with_every_condition_met_places_one_call_and_then_refuses_a_second(capsys, sdk, tmp_path):
    environ = dict(READY, CALLE_BASE_URL="https://test-api.heycall-e.com/")
    assert cli.main(LIVE, environ=environ, now=NOON_NY) == 0
    out = capsys.readouterr().out
    assert sdk == [{"api_key": "test-key-not-real", "base_url": "https://test-api.heycall-e.com"}]
    assert "decision         would be filed as customer communication" in out
    assert (tmp_path / "out" / "live" / "du_demo_1042.pdf").exists()
    assert "test-key-not-real" not in out and "2125550101" not in out
    # the evidence document on file now marks this dispute as called
    assert cli.main(LIVE, environ=environ, now=NOON_NY) == 2
    assert "SECOND_CALL_TO_CUSTOMER" in capsys.readouterr().out and len(sdk) == 1


def test_an_ambiguous_create_is_reported_and_never_retried(capsys, monkeypatch, tmp_path):
    attempts = []

    class Flaky:
        def __init__(self, **kwargs):
            self.calls = self

        def create(self, **kwargs):
            attempts.append(kwargs["idempotency_key"])
            raise TimeoutError("read timed out")

        def close(self):
            pass

    module = types.ModuleType("calle")
    module.CalleClient = Flaky
    monkeypatch.setitem(sys.modules, "calle", module)
    assert cli.main(LIVE, environ=READY, now=NOON_NY) == 3
    out = capsys.readouterr().out
    assert attempts == ["rebuttal-confirm-receipt-v2-du_demo_1042"]
    assert "A call may still have been placed" in out and not (tmp_path / "out" / "live").exists()


def test_numbers_spoken_on_a_call_are_masked_in_output():
    assert cli.scrub("call me on 212 555 0101 tomorrow") == "call me on +21****0101 tomorrow"
    assert cli.scrub("order 1042 for $89.00") == "order 1042 for $89.00"


def test_a_dispute_id_cannot_leave_the_output_folder(capsys, tmp_path):
    assert cli.main(["dry-run", "--dispute", "../../elsewhere"], environ={}, now=NOON_NY) == 2
    assert not (tmp_path / "out").exists()


def test_the_fake_rejects_an_unknown_scenario():
    with pytest.raises(ValueError):
        FakeCalle("voicemail")
