from fieldline.calle_client import DemoCallScript, DemoCalleDispatcher
from fieldline.demo_data import SCENARIOS, demo_trip_plan
from fieldline.engine import DemoWaiter, TripEngine
from fieldline.render import QuietRenderer


def run_scenario(scripts, tmp_path):
    engine = TripEngine(
        plan=demo_trip_plan(),
        dispatcher=DemoCalleDispatcher(scripts, turn_delay=0.0),
        renderer=QuietRenderer(),
        home=tmp_path,
        demo=True,
        waiter=DemoWaiter(fast=True),
    )
    return engine.run()


def test_full_scenario_hands_off_and_writes_brief(tmp_path):
    result = run_scenario(SCENARIOS["full"], tmp_path)
    assert result.status == "handed_off"
    assert len(result.records) == 5  # safe + 2 unanswered dials + 2 escalation calls
    assert result.report_path and result.report_path.exists()
    brief = result.report_path.read_text()
    assert "Dr. Rivera" in brief and "Timeline" in brief
    assert "+15555550100" not in brief  # phones masked in the brief


def test_safe_scenario_closes_without_incident(tmp_path):
    result = run_scenario(SCENARIOS["safe"], tmp_path)
    assert result.status == "closed_safe"
    assert result.report_path is None
    assert len(result.records) == 2


def test_duress_skips_ladder_to_top_rung(tmp_path):
    result = run_scenario(SCENARIOS["duress"], tmp_path)
    assert result.status == "handed_off"
    # 2 check-ins + exactly ONE escalation call (silent: straight to the top)
    assert len(result.records) == 3
    assert result.records[-1].party == "Dr. Rivera"
    assert result.report_path and "duress" in result.report_path.read_text().lower()


def _no_answer(at):
    return DemoCallScript(kind="checkin", at=at, answered=False, summary="No answer.", task_completed=False)


def test_stand_down_resumes_schedule(tmp_path):
    scripts = [
        _no_answer("14:00"),
        _no_answer("14:05"),
        DemoCallScript(
            kind="escalation",
            at="14:16",
            answered=True,
            turns=[("bot", "…"), ("user", "They just texted me, all fine — flat battery.")],
            structured_result={"contact_reached": True, "heard_from_worker_since_checkin": True},
            summary="Contact heard from worker minutes ago.",
            task_completed=True,
        ),
        SCENARIOS["safe"][1],  # 18:00 check-in green
    ]
    result = run_scenario(scripts, tmp_path)
    assert result.status == "closed_safe"
    assert result.report_path is None


def test_exhausted_ladder_flags_manual_action(tmp_path):
    scripts = [
        _no_answer("14:00"),
        _no_answer("14:05"),
        DemoCallScript(kind="escalation", at="14:16", answered=False, task_completed=False),
        DemoCallScript(kind="escalation", at="14:23", answered=False, task_completed=False),
    ]
    result = run_scenario(scripts, tmp_path)
    assert result.status == "unreachable_ladder"
    assert result.report_path and "manual action" in result.report_path.read_text().lower()
