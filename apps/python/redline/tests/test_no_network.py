"""Prove that the default paths cannot reach the network.

This is the test that protects a credit balance. CALL-E has no sandbox, every
placed call costs five credits and rings a real telephone, and the offline
promise -- "clone it, run it, no account needed" -- is the whole reason a
reviewer would try this tool at all. Both claims rest on the same property, and
until now that property was documented rather than enforced.

The method is blunt on purpose. Every socket constructor in the standard
library is replaced with one that raises, and then the entire product is
driven: load the catalogue, run the suite, generate a patch, verify it, render
all three report formats, and run the credential diagnostics. If any of it
opens a socket, these tests fail with the traceback pointing at the line that
did it.

Blocking at the socket layer rather than at `httpx` is deliberate. It catches
any client library, anything vendored, and anything added later by somebody who
has never read this file.

`subprocess` is *not* blocked. `doctor` asks git whether a file is ignored, and
that is a local, free question. The line being drawn here is the network, not
the process boundary.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from redline.cli import app
from redline.doctor import run_diagnostics
from redline.evaluate import assertion_names
from redline.remediate import generate_patch
from redline.report import render_html, report_to_dict, verification_to_dict
from redline.runner import run_suite
from redline.scenario import load_scenarios
from redline.spend import SpendLedger
from redline.subject import SubjectUnderTest
from redline.transport import MockTransport, ReplayTransport
from redline.verify import verify_patch

CATALOGUE = Path(__file__).resolve().parent.parent / "scenarios"
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "calle"

BARE_GOAL = (
    "Call the customer and confirm whether they can still attend their "
    "appointment on Thursday at 2pm. Ask them to confirm yes or no."
)

BOOLEAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "confirmed": {
            "type": "boolean",
            "description": "Whether the customer confirmed the appointment.",
        }
    },
}


class NetworkUsedError(AssertionError):
    """Something tried to open a socket on a path that must not."""


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Make every outbound network call impossible for the duration of a test."""

    def refuse(*args: object, **kwargs: object) -> None:
        raise NetworkUsedError(
            "a socket was opened on a path that must work offline. "
            "Nothing except the live transport may reach the network."
        )

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    # Cover the lower-level entry points a client library might reach for.
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    yield


def bare_agent() -> SubjectUnderTest:
    return SubjectUnderTest(
        name="appointment-agent",
        goal=BARE_GOAL,
        result_schema=BOOLEAN_SCHEMA,
        context={"appointment_time": "Thursday 2pm"},
    )


class TestTheFixtureItselfWorks:
    def test_the_guard_actually_blocks_a_socket(self, no_network: None) -> None:
        # A test that cannot fail proves nothing. This one shows the guard is
        # armed, so the silence of every other test in this file means
        # something.
        with pytest.raises(NetworkUsedError):
            socket.socket()

    def test_the_guard_blocks_name_resolution_too(self, no_network: None) -> None:
        with pytest.raises(NetworkUsedError):
            socket.getaddrinfo("api.heycall-e.com", 443)


class TestTheWholeProductRunsOffline:
    def test_the_catalogue_loads(self, no_network: None) -> None:
        assert load_scenarios(CATALOGUE, known_assertions=assertion_names())

    def test_a_full_mock_run_places_nothing(self, no_network: None) -> None:
        scenarios = load_scenarios(CATALOGUE, known_assertions=assertion_names())
        report = run_suite(bare_agent(), scenarios, MockTransport())
        assert report.total == len(scenarios)
        assert report.real_calls_placed == 0

    def test_the_whole_loop_runs_offline(self, no_network: None) -> None:
        # Detect, remediate, verify. The demo, with the network unplugged.
        scenarios = load_scenarios(CATALOGUE, known_assertions=assertion_names())
        transport = MockTransport()
        agent = bare_agent()

        before = run_suite(agent, scenarios, transport)
        patch = generate_patch(before, agent)
        verification = verify_patch(patch, scenarios, transport, before=before)

        assert verification.fully_closed
        assert verification.regressions == ()

    def test_every_report_format_renders_offline(self, no_network: None) -> None:
        scenarios = load_scenarios(CATALOGUE, known_assertions=assertion_names())
        transport = MockTransport()
        agent = bare_agent()
        before = run_suite(agent, scenarios, transport)
        patch = generate_patch(before, agent)
        verification = verify_patch(patch, scenarios, transport, before=before)

        assert report_to_dict(before)["schema_version"] == 1
        assert verification_to_dict(verification)["closed"]
        assert render_html(before).startswith("<!doctype html>")

    def test_replaying_a_fixture_is_offline(self, no_network: None) -> None:
        scenarios = load_scenarios(CATALOGUE, known_assertions=assertion_names())
        injection = next(s for s in scenarios if s.id == "voice-prompt-injection")
        record = ReplayTransport(FIXTURES).run(
            bare_agent(), injection, idempotency_key="k"
        )
        assert record.transport == "replay"

    def test_the_credential_check_is_offline_by_default(
        self, no_network: None, tmp_path: Path
    ) -> None:
        # `doctor` without --online must never touch the network. It shells out
        # to git, which is local and free; that is allowed and is not a socket.
        diagnosis = run_diagnostics(start=tmp_path)
        assert not diagnosis.online


class TestTheCommandLineIsOffline:
    """The commands a reviewer will actually type."""

    runner = CliRunner()

    @pytest.fixture
    def project(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
        monkeypatch.chdir(tmp_path)
        assert self.runner.invoke(app, ["init"]).exit_code == 0
        return tmp_path

    def test_init_check_run_fix_verify_never_open_a_socket(
        self, project: Path, no_network: None
    ) -> None:
        assert self.runner.invoke(app, ["check"]).exit_code == 0
        assert self.runner.invoke(app, ["run"]).exit_code == 1
        assert self.runner.invoke(app, ["fix"]).exit_code == 0
        assert self.runner.invoke(app, ["verify"]).exit_code == 0
        assert self.runner.invoke(app, ["scenarios"]).exit_code == 0
        assert self.runner.invoke(app, ["assertions"]).exit_code == 0

    def test_a_json_report_is_written_offline(
        self, project: Path, no_network: None
    ) -> None:
        result = self.runner.invoke(app, ["verify", "--json", "report.json"])
        assert result.exit_code == 0
        assert (project / "report.json").exists()

    def test_doctor_is_offline_without_the_flag(
        self, project: Path, no_network: None
    ) -> None:
        # Exit code 1 because no key is configured here; what matters is that
        # it reached that verdict without a socket.
        assert self.runner.invoke(app, ["doctor"]).exit_code == 1


class TestNothingIsSpentOffline:
    def test_a_mock_run_spends_no_credits(self, no_network: None) -> None:
        ledger = SpendLedger(call_budget=0)
        scenarios = load_scenarios(CATALOGUE, known_assertions=assertion_names())
        run_suite(bare_agent(), scenarios, MockTransport())
        ledger.assert_nothing_was_spent()
        assert ledger.credits_spent == 0

    def test_the_default_budget_forbids_every_call(self) -> None:
        # Belt to the socket guard's braces: even with a network, the ledger
        # refuses. Two independent reasons a stray call cannot happen.
        from redline.spend import WetOperationRefusedError

        ledger = SpendLedger()
        assert ledger.call_budget == 0
        with pytest.raises(WetOperationRefusedError):
            ledger.record_wet("calls.create")
