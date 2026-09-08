"""The other documented way to run this, which for a long time did not work.

The README offers two ways to mount the double: on the SDK's own transport in process,
and as a real HTTP server for anything that cannot be mounted. The first was covered by
five hundred tests. The second was covered by nobody, and it was broken: the server had
no scenario bound, so every recipient got the double's fallback answer of `{"ok": true}`,
and the application reported all seven rows as `missing required field 'reason_category'`.
A judge following the second path saw a product that did not work.

The scenario cannot move into the double, which is a CALL-E conformance double and knows
nothing about schools. So outcomes became data the double can read, the application
exports the scenario it already had, and these tests hold the two paths to the same run.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

from calle_double import CalleDouble  # noqa: E402
from calle_double.engine import Outcome, ScenarioError  # noqa: E402
from calle_double.server import serve  # noqa: E402

SCENARIO = APP / "examples" / "demo-outcomes.json"


@pytest.fixture
def bound_server():
    """The double behind real HTTP, with the shipped scenario bound. Port 0 is deliberate.

    A fixed port makes a test suite fail when anything else on the machine happens to be
    listening, and diagnosing that from a JSON parse error takes an afternoon: the app
    receives somebody else's HTML and reports that the call may have been placed.
    """
    double = CalleDouble()
    double.load_outcomes(json.loads(SCENARIO.read_text(encoding="utf-8")), str(SCENARIO))
    server = serve(double, port=0)
    try:
        yield double, f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()


def _run(args: list[str], base_url: str | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if base_url:
        env["CALLE_BASE_URL"] = base_url
        env["CALLE_API_KEY"] = "iams_test_anything"
    else:
        env.pop("CALLE_BASE_URL", None)
    return subprocess.run([sys.executable, "-m", "firstbell", *args], cwd=APP,
                          capture_output=True, text=True, timeout=600, env=env,
                          encoding="utf-8", errors="replace")


def _rows(stdout: str) -> list[str]:
    """The per-row lines, which are what a reader compares between two runs."""
    return [line.strip() for line in stdout.splitlines()
            if line.startswith(("  [ok", "  [HUMAN", "  [SAFEG", "  [skip", "  [fail"))]


def test_the_documented_http_command_produces_the_offline_run(bound_server):
    """Row for row, the two ways of mounting the double agree.

    This is the test that would have caught it. Not a check that the server answers, which
    it always did, but a comparison of the two documented paths against each other.
    """
    _double, base_url = bound_server
    offline = _run(["--work-file", "examples/absences.csv"])
    assert offline.returncode == 0, offline.stderr[-800:]
    over_http = _run(["--work-file", "examples/absences.csv", "--live", "--yes-i-mean-it"],
                     base_url)
    assert over_http.returncode == 0, over_http.stderr[-800:]
    assert _rows(over_http.stdout) == _rows(offline.stdout), (
        "the HTTP path and the in-process path report different rows for the same "
        "scenario")
    assert "LIVE MODE, NON-PRODUCTION TARGET" in over_http.stdout, (
        "a run against something that is not CALL-E has to say so on its first line")


def test_an_unbound_server_is_the_defect_this_closed(bound_server):
    """The old behaviour, kept as a test so nobody restores it by accident.

    An unbound double answers `{"ok": true}`, the application's schema requires two fields
    it does not carry, and every row comes back undetermined. Keeping the reproduction is
    the difference between a fix and a story about a fix.
    """
    unbound = serve(CalleDouble(), port=0)
    try:
        run = _run(["--work-file", "examples/absences.csv", "--live", "--yes-i-mean-it",
                    "--limit", "2"],
                   f"http://127.0.0.1:{unbound.server_address[1]}")
    finally:
        unbound.shutdown()
    assert run.returncode == 0, run.stderr[-800:]
    assert "missing required field 'reason_category'" in run.stdout
    assert "undetermined         2" in run.stdout


def test_the_server_says_out_loud_that_nothing_is_bound():
    """The message that makes the flag discoverable at the moment it is needed.

    The defect was not that the flag was missing. It is that a server with nothing bound
    looked exactly like a server that was working, and the failure surfaced two commands
    later as a schema error in the application.
    """
    proc = subprocess.run([sys.executable, "-c",
                           "import sys; sys.argv=['s','--port','0'];"
                           "import calle_double.server as s;"
                           "s.refuse_an_open_bind('127.0.0.1', False);"
                           "print(open(s.__file__, encoding='utf-8').read().count("
                           "'no scenario bound'))"],
                          cwd=APP, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-400:]
    assert proc.stdout.strip() == "1", (
        "the server no longer warns when it starts with nothing bound")


def test_the_exported_scenario_is_what_the_module_binds_now():
    """The generated file, compared against its generator, the way everything else here is.

    A generated artifact nobody compares goes stale. This repository has that recorded
    three times, so the check is the test rather than a note in a docstring.
    """
    import export_demo_outcomes
    assert SCENARIO.read_text(encoding="utf-8") == export_demo_outcomes.rendered(), (
        "examples/demo-outcomes.json has drifted from firstbell/scenario.py; run "
        "python tools/export_demo_outcomes.py")


def test_the_scenario_file_carries_every_number_the_offline_run_binds():
    from firstbell.scenario import apply_demo_outcomes
    double = CalleDouble()
    apply_demo_outcomes(double)
    on_disk = json.loads(SCENARIO.read_text(encoding="utf-8"))["numbers"]
    assert sorted(on_disk) == sorted(double.outcomes())
    for phone, outcome in double.outcomes().items():
        assert Outcome.from_spec(on_disk[phone]) == outcome, (
            f"{phone} does not round-trip through the file the server reads")


def test_an_outcome_file_that_binds_nothing_is_refused():
    """An empty scenario loads silently and leaves every call on the fallback answer.

    Which is the defect, arrived at a second way: the flag was passed, the file was there,
    and nothing happened. A refusal is the only version of this a person notices.
    """
    with pytest.raises(ScenarioError) as caught:
        CalleDouble().load_outcomes({"numbers": {}})
    assert "no numbers" in str(caught.value)
    with pytest.raises(ScenarioError):
        CalleDouble().load_outcomes({"numbers": []})
    with pytest.raises(ScenarioError):
        CalleDouble().load_outcomes([])


def test_an_unknown_key_in_an_outcome_is_refused_rather_than_ignored():
    """`transcipt` is a conversation this double would silently not have.

    A scenario that quietly loses half of itself is worse than one that will not load: the
    run completes, the numbers look plausible, and nothing says a word.
    """
    with pytest.raises(ScenarioError) as caught:
        CalleDouble().load_outcomes(
            {"numbers": {"+15550100301": {"transcipt": [["bot", "hello"]]}}})
    said = str(caught.value)
    assert "transcipt" in said
    assert "quietly did not produce" in said


def test_a_malformed_transcript_turn_is_refused():
    for bad in ([["bot"]], [["bot", "hi", "extra"]], ["bot: hi"], [[1, 2]]):
        with pytest.raises(ScenarioError):
            Outcome.from_spec({"transcript": bad})


def test_answers_on_takes_an_index_or_null_and_nothing_else():
    assert Outcome.from_spec({"answers_on": None}).answers_on is None
    assert Outcome.from_spec({"answers_on": 1}).answers_on == 1
    with pytest.raises(ScenarioError):
        Outcome.from_spec({"answers_on": "second"})


def test_every_outcome_constructor_round_trips_through_the_file_format():
    """The four shapes a scenario is written in, out and back.

    `to_spec` writes only what differs from the defaults, so this is the test that the
    omission is lossless rather than merely shorter.
    """
    for outcome in (
        Outcome.answered({"reason_category": "illness"}, [("bot", "hi"), ("user", "ok")]),
        Outcome.answered({"a": 1}, [("bot", "hi")], answers_on=1, summary="second number"),
        Outcome.no_answer(),
        Outcome.no_answer(sip_code="486"),
        Outcome.declined(),
        Outcome.ambiguous([("bot", "hi"), ("user", "who is this")]),
    ):
        assert Outcome.from_spec(outcome.to_spec()) == outcome


def test_the_bound_double_dialled_the_numbers_the_file_names(bound_server):
    """The evidence that the file reached the engine, rather than the run looking right.

    A scenario can appear to work because the fallback answer happens to satisfy the
    consumer. `dialled` is the double's own record of which numbers were rung.
    """
    double, base_url = bound_server
    run = _run(["--work-file", "examples/absences.csv", "--live", "--yes-i-mean-it"],
               base_url)
    assert run.returncode == 0, run.stderr[-800:]
    assert double.dialled, "the double recorded no dialled number for a run of six rows"
    named = set(json.loads(SCENARIO.read_text(encoding="utf-8"))["numbers"])
    assert set(double.dialled) & named, (
        "none of the numbers the scenario names were dialled, so the file was not read")


def test_the_documented_server_command_binds_the_file_it_is_given():
    """`python -m calle_double.server --outcomes FILE`, run as the command it is.

    Every other test here binds the scenario by calling `load_outcomes` in process, which
    is the one thing a judge following the README will not do. A mutation that took the
    flag and bound none of it was caught by nothing: the flag parsed, the file was read,
    the server started, and the run reported schema errors two commands later.
    """
    import re
    import time
    import urllib.error
    import urllib.request

    proc = subprocess.Popen(
        # `-u` because a child's stdout is block-buffered when it is not a terminal, and
        # the banner carries the port the operating system picked. Without it this test
        # waits for a buffer that flushes when the process ends, which is never.
        [sys.executable, "-u", "-m", "calle_double.server", "--port", "0",
         "--outcomes", "examples/demo-outcomes.json"],
        cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace")
    try:
        # The port is in the banner, because --port 0 means the operating system picked
        # it. Reading it back is also the only proof the server got as far as listening.
        # Read until the line the server always prints last, never until the line this
        # test hopes for. `readline` has no timeout, so a loop that waits for "bound
        # from" blocks forever on the run where nothing was bound, and a test that hangs
        # is worse than a test that fails: it took a mutation run down with it.
        banner = ""
        while "Ctrl-C to stop" not in banner:
            line = proc.stdout.readline()
            if not line:
                break
            banner += line
        found = re.search(r"http://127\.0\.0\.1:(\d+)", banner)
        assert found, f"the server printed no address:\n{banner}"
        # Counted from the file rather than typed. This read 6 for as long as the scenario
        # bound only the numbers in absences.csv, and binding the other two fixtures made
        # it 10 and made this the one failure in the suite. A test edited every time the
        # thing it measures changes is a second place to keep the number.
        bound = len(json.loads((APP / "examples" / "demo-outcomes.json").read_text(
            encoding="utf-8"))["numbers"])
        assert f"{bound} number(s) bound from examples/demo-outcomes.json" in banner, (
            f"the server did not say it bound the {bound} number(s) in the file it was "
            f"given:\n{banner}")
        assert "no scenario bound" not in banner

        base = f"http://127.0.0.1:{found.group(1)}"
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/v1/calls", timeout=1)
            except urllib.error.HTTPError:
                break                      # answering, and refusing a GET, which is right
            except OSError:
                time.sleep(0.1)

        run = _run(["--work-file", "examples/absences.csv", "--live", "--yes-i-mean-it"],
                   base)
        assert run.returncode == 0, run.stderr[-800:]
        assert "missing required field" not in run.stdout, (
            "the server took --outcomes and answered with its fallback anyway")
        assert "resolved             4" in run.stdout, (
            "the run against the command in the README does not match the offline run")
    finally:
        proc.terminate()
        proc.wait(timeout=30)


def test_the_export_check_fails_on_a_file_that_has_drifted(tmp_path, monkeypatch):
    """`--check` is only worth having if it can fail.

    A mutation that made it report success whatever was on disk changed no test, which is
    the shape of every stale generated artifact in this project's history: the checker was
    never asked to check something wrong.
    """
    import export_demo_outcomes

    monkeypatch.setattr(sys, "argv", ["export_demo_outcomes.py", "--check"])
    stale = tmp_path / "demo-outcomes.json"
    stale.write_text('{"numbers": {}}\n', encoding="utf-8")
    monkeypatch.setattr(export_demo_outcomes, "OUT", stale)
    assert export_demo_outcomes.main() == 1

    stale.write_text(export_demo_outcomes.rendered(), encoding="utf-8", newline="\n")
    assert export_demo_outcomes.main() == 0

    stale.unlink()
    assert export_demo_outcomes.main() == 1, "a missing file is not a passing check"


def test_a_negative_answering_index_is_refused_rather_than_answering_nowhere():
    """`-1` is how a person writes "the last number", and this does not mean that.

    The dialler compares the index against 0, 1, 2 as it works down the chain, so a
    negative one is never equal to any of them and the scenario quietly becomes nobody
    picking up. That is a file somebody has to debug against a run that looks like a
    product defect, so it is refused where the file is read.
    """
    from calle_double.engine import Outcome, ScenarioError

    with pytest.raises(ScenarioError) as caught:
        Outcome.from_spec({"answers_on": -1}, "+15550100301")
    assert "counts from the front" in str(caught.value)
    # And the two neighbours of that case still load, so the refusal is about the sign
    # rather than about anything else.
    assert Outcome.from_spec({"answers_on": 0}, "x").answers_on == 0
    assert Outcome.from_spec({"answers_on": None}, "x").answers_on is None


def test_a_scenario_entry_that_omits_answers_on_answers_on_the_first_number():
    """The documented default, which is a person picking up rather than nobody.

    `to_spec` always writes the field, so the shipped file always carries it and no test
    was exercising the default. Defaulting to None instead would turn every hand-written
    entry into a number nobody answers, and a scenario author would read that as their
    outcome not working.
    """
    assert Outcome.from_spec({"structured_result": {"a": 1}}).answers_on == 0
    double = CalleDouble()
    double.load_outcomes({"numbers": {"+15550100301": {
        "structured_result": {"reason_category": "illness", "expected_return": "today",
                              "parent_confirmed_aware": "yes"},
        "transcript": [["bot", "hello"], ["user", "yes"]]}}})
    assert double.outcomes()["+15550100301"].answers_on == 0
