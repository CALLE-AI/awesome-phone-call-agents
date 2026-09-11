"""Offline tests: the bundled fixtures regrade to the bundled verdicts, contain no real numbers, and every command
that is supposed to place no call places no call. No network, no credentials."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR))

import otherend  # noqa: E402

from voxprobe.otherend import GradeReport  # noqa: E402

FIXTURES = APP_DIR / "fixtures"
ROWS = otherend.load_fixture_rows(FIXTURES)
# Receptionist-profile rows (scenario probe 02-constraints): six profiles, two of them run twice.
EXPECTED_PROFILE_ROWS = {
    "ai-disclosure-probe": 1,
    "asks-for-id-details": 1,
    "cooperative": 1,
    "evasive-minimal": 1,
    "hold-then-continue": 1,
    "saturday-false-offer": 1,
}
# Callee-persona rows (foreign probe foreign-appointment-confirm): one call per persona.
EXPECTED_CALLEE_ROWS = {
    "kay2-amelia-ambiguous": 1,
    "kay2-amelia-confirms": 1,
    "kay2-amelia-reschedules": 1,
}
FOREIGN_PROBE = "foreign-appointment-confirm"


@pytest.fixture(autouse=True)
def _no_credentials_no_calls(monkeypatch):
    """Strip every credential and make any subprocess spawn a test failure."""
    for name in (*otherend.REQUIRED_LIVE_ENV, *otherend.BRAIN_ENV, *otherend.OPTIONAL_LIVE_ENV, "CALLE_TARGET_E164"):
        monkeypatch.delenv(name, raising=False)

    def _boom(*args, **kwargs):  # pragma: no cover - only reached on a regression
        raise AssertionError(f"subprocess.run was called: {args[0] if args else kwargs}")

    monkeypatch.setattr(subprocess, "run", _boom)


def _counts(rows):
    out: dict[str, int] = {}
    for r in rows:
        out[r.profile_id] = out.get(r.profile_id, 0) + 1
    return out


def test_nine_synthetic_rows_six_profiles_plus_three_personas():
    assert len(ROWS) == 9
    profile_rows = [r for r in ROWS if r.probe_id == "02-constraints"]
    callee_rows = [r for r in ROWS if r.probe_id == FOREIGN_PROBE]
    assert len(profile_rows) + len(callee_rows) == 9
    assert _counts(profile_rows) == EXPECTED_PROFILE_ROWS
    assert _counts(callee_rows) == EXPECTED_CALLEE_ROWS
    assert len({r.calle_stem for r in ROWS}) == 9, "every row is a distinct synthetic conversation"


@pytest.mark.parametrize("row", ROWS, ids=[r.short for r in ROWS])
def test_replay_regrades_to_the_bundled_verdicts(row):
    report = otherend.regrade(row, otherend.settings())
    bundled = GradeReport.model_validate(row.bundled)
    assert otherend.verdicts(report) == otherend.verdicts(bundled)
    assert report.overall == bundled.overall  # two synthetic rows are fail/unknown by design
    assert report.usable and bundled.usable
    # the evidence strings are part of the contract too: same quotes, same reported values
    assert [c.evidence for c in report.checks] == [c.evidence for c in bundled.checks]


def test_callee_rows_grade_the_foreign_schema_fields():
    """A persona row is graded with grade_foreign: manifest, one check per field of THEIR schema, no goal/criteria."""
    for row in ROWS:
        if row.probe_id != FOREIGN_PROBE:
            continue
        checks = [c["check"] for c in row.bundled["checks"]]
        assert checks[0] == "manifest"
        assert {"field.can_attend", "field.disposition", "field.confirmed_time", "field.requested_time"} <= set(checks)
        assert "goal_achieved" not in checks and not any(c.startswith("criteria.") for c in checks)
        assert row.bundled["target_id"] == f"callee:{row.profile_id}"


def test_replay_command_prints_suite_and_exits_clean(capsys):
    assert otherend.main(["replay", "--fixtures", str(FIXTURES)]) == 0
    out = capsys.readouterr().out
    assert "regrading 9 bundled row(s)" in out
    assert "## Suite" in out
    for profile in (*EXPECTED_PROFILE_ROWS, *EXPECTED_CALLEE_ROWS):
        assert profile in out
    assert "DIFFERENT" not in out


def _without_structured_result(obj):
    """Drop graded content (structured_result, grade checks) before scanning for leaked metadata."""
    if isinstance(obj, dict):
        return {k: _without_structured_result(v) for k, v in obj.items() if k not in ("structured_result", "checks")}
    if isinstance(obj, list):
        return [_without_structured_result(v) for v in obj]
    return obj


def test_fixtures_contain_no_real_phone_numbers_and_no_caller_keys():
    files = [p for p in FIXTURES.rglob("*") if p.is_file()]
    assert len(files) == 9 * 5, "grade, calle json, calle md, line md, line meta per row"
    for path in files:
        assert path.suffix in {".json", ".md"}, f"unexpected fixture type (audio is never bundled): {path.name}"
        assert ":" not in path.name, f"a ':' in a file name cannot be checked out on Windows: {path.name}"
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"\+\d{7,15}", text):
            assert m.group(0) in ("+1XXXXXXXXXX", "+12025550100"), f"unmasked E.164 in {path.name}"
        assert "@" not in text.replace("@0", ""), f"an email-looking token in {path.name}"
        for marker in ("/Users" + "/", "/home" + "/"):  # a home directory would name the author's machine
            assert marker not in text, f"an absolute path in {path.name}"
        if path.name.endswith(".meta.json"):
            meta = json.loads(text)
            assert not {"from", "customer", "number"} & set(meta), f"caller keys left in {path.name}"
        # platform identifiers, absolute timestamps, costs and latency metrics are not evidence and were removed.
        # structured_result is graded content and may legitimately hold an ISO time from the task (an allowed window).
        assert not re.search(r"\bcall_[A-Za-z0-9_-]{8,}|\batt_[a-f0-9]{8,}", text), f"a CALL-E id left in {path.name}"
        assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text), f"a UUID left in {path.name}"
        if path.suffix == ".json":
            scan = json.dumps(_without_structured_result(json.loads(text)))
        else:
            scan = "\n".join(ln for ln in text.splitlines() if not ln.startswith("- structured_result:"))
        assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", scan), f"an absolute timestamp left in {path.name}"
        for token in ("cost_usd", "performance_metrics", "turnLatenc", "provider_call_id"):
            assert token not in text, f"{token} left in {path.name}"


def test_plan_is_offline_and_prints_what_was_actually_sent(capsys):
    row = next(r for r in ROWS if r.profile_id == "cooperative")
    sent = json.loads(row.calle_path.read_text(encoding="utf-8"))["request"]
    plan = otherend.build_plan("cooperative", "02-constraints", business="Sunrise Orthopedics", to=None)
    assert plan["request"]["task"] == sent["task"]
    assert plan["request"]["result_schema"] == sent["result_schema"]
    assert plan["request"]["recipients"][0]["phones"] == ["+1XXXXXXXXXX"]
    assert plan["recipient_source"] == "placeholder"

    assert otherend.main(["plan", "--profile", "saturday-false-offer", "--probe", "02-constraints"]) == 0
    out = capsys.readouterr().out
    assert "NO CALL PLACED" in out
    assert "Daniel Reyes" in out
    assert "weekend_booking" in out
    assert "result_schema" in out
    assert "+1XXXXXXXXXX" in out, "the placeholder recipient should be shown masked"
    assert not re.search(r"\+\d{7,15}", out), "an unmasked phone number reached the plan output"


def test_plan_callee_is_offline_and_prints_the_foreign_task_verbatim(capsys):
    row = next(r for r in ROWS if r.profile_id == "kay2-amelia-reschedules")
    sent = json.loads(row.calle_path.read_text(encoding="utf-8"))["request"]
    plan = otherend.build_plan_callee("kay2-amelia-reschedules", FOREIGN_PROBE, to=None)
    assert plan["request"]["task"] == sent["task"]
    assert plan["request"]["result_schema"] == sent["result_schema"]
    assert plan["request"]["metadata"] == sent["metadata"] == {"voxprobe_probe": FOREIGN_PROBE}
    assert plan["request"]["recipients"][0]["phones"] == ["+1XXXXXXXXXX"]
    assert plan["probe"]["kind"] == "foreign"
    assert [c["check"] for c in plan["checks"]] == [
        "manifest",
        "field.can_attend",
        "field.disposition",
        "field.requested_time",
        "field.confirmed_time",
        "invented_callback_number",
        "invented_member_id",
        "confidence_calibration",
    ]

    assert otherend.main(["plan", "--callee", "kay2-amelia-reschedules", "--probe", FOREIGN_PROBE]) == 0
    out = capsys.readouterr().out
    assert "NO CALL PLACED" in out
    assert "Friday the fourth at ten works for me." in out, "the persona's scripted decision"
    assert "KAY2 Studios" in out and "Speak with Amelia." in out, "the foreign task text"
    assert '"can_attend"' in out and "reschedule_requested" in out, "the foreign schema"
    assert "field.requested_time" in out and "2026-09-04T10:00" in out
    assert "Daniel Reyes" not in out, "nothing from the voxprobe scenario leaks into a foreign plan"
    assert not re.search(r"\+\d{7,15}", out), "an unmasked phone number reached the plan output"


def test_foreign_probe_is_appointment_confirm_task_and_schema_verbatim():
    """The bundled probe's task text and schema are this repository's appointment-confirm app's, unchanged, for its
    sample intake; the only edit the probe made is the recipient's phone/region/locale."""
    sibling = APP_DIR.parent / "appointment-confirm"
    sys.path.insert(0, str(sibling))
    from appointment_confirm.schema import load_intake, recipient_result_schema  # noqa: E402
    from appointment_confirm.task import build_task  # noqa: E402

    _persona, probe = otherend.load_callee_and_probe("kay2-amelia-confirms", FOREIGN_PROBE, otherend.settings())
    intake = load_intake(sibling / "fixtures" / "sample_appointment.json")
    intake.update(phone=otherend.PLACEHOLDER_E164, region="US", locale="en-US")
    assert build_task(intake) == probe.task_text
    assert recipient_result_schema() == probe.result_schema
    assert probe.kind == "foreign" and "appointment-confirm" in probe.source


def test_plan_rejects_unknown_profile_and_persona():
    with pytest.raises(SystemExit, match="no profile"):
        otherend.main(["plan", "--profile", "does-not-exist", "--probe", "02-constraints"])
    with pytest.raises(SystemExit, match="no callee persona"):
        otherend.main(["plan", "--callee", "does-not-exist", "--probe", FOREIGN_PROBE])


def test_plan_rejects_a_probe_of_the_wrong_kind():
    with pytest.raises(SystemExit, match="need a foreign probe"):
        otherend.main(["plan", "--callee", "kay2-amelia-confirms", "--probe", "02-constraints"])
    with pytest.raises(SystemExit, match="need a scenario probe"):
        otherend.main(["plan", "--profile", "cooperative", "--probe", FOREIGN_PROBE])
    with pytest.raises(SystemExit):  # argparse: --profile and --callee are mutually exclusive
        otherend.main(["plan", "--profile", "cooperative", "--callee", "kay2-amelia-confirms", "--probe", FOREIGN_PROBE])


def test_live_refuses_without_yes():
    with pytest.raises(SystemExit, match="--yes"):
        otherend.main(["live", "--profile", "cooperative", "--probe", "02-constraints", "--max-calls", "1"])
    with pytest.raises(SystemExit, match="--yes"):
        otherend.main(["live", "--callee", "kay2-amelia-confirms", "--probe", FOREIGN_PROBE, "--max-calls", "1"])


def test_live_refuses_more_rows_than_budget():
    with pytest.raises(SystemExit, match="each profile is exactly one call"):
        otherend.main(
            ["live", "--profile", "cooperative", "--profile", "evasive-minimal", "--probe", "02-constraints",
             "--max-calls", "1", "--yes"]
        )
    with pytest.raises(SystemExit, match="each callee is exactly one call"):
        otherend.main(
            ["live", "--callee", "kay2-amelia-confirms", "--callee", "kay2-amelia-ambiguous", "--probe", FOREIGN_PROBE,
             "--max-calls", "1", "--yes"]
        )


def test_live_refuses_without_credentials():
    for who in (["--profile", "cooperative", "--probe", "02-constraints"], ["--callee", "kay2-amelia-confirms", "--probe", FOREIGN_PROBE]):
        with pytest.raises(SystemExit) as exc:
            otherend.main(["live", *who, "--max-calls", "1", "--yes"])
        message = str(exc.value)
        assert "CALLE_API_KEY" in message and "VAPI_API_KEY" in message and "ALLOWED_NUMBERS_E164" in message
        assert "Nothing was placed" in message


def test_report_renders_bundled_grades(tmp_path):
    out = tmp_path / "REPORT.md"
    assert otherend.main(["report", "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert text.startswith("# otherend")
    assert text.count("overall: **pass**") == 7  # saturday-false-offer fails, ai-disclosure-probe is unknown, by design
    assert text.count("overall: **fail**") == 1 and text.count("overall: **unknown**") == 1
    assert "callee:kay2-amelia-reschedules" in text
    assert not re.search(r"\+\d{7,15}", text), "a phone number reached the rendered report"


def test_mask_number_and_portable_stem():
    assert otherend.mask_number("+12025550100") == "+1XXXXXXXXXX"
    assert otherend.mask_text("dial +12025550100 now") == "dial +1XXXXXXXXXX now"
    assert otherend.portable_stem("line-x-callee:kay2-amelia-confirms-20260908-c6e977") == (
        "line-x-callee-kay2-amelia-confirms-20260908-c6e977"
    )
