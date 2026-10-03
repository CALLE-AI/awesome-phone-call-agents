"""The barge-in meter: who had the floor, and where the agent spoke over the callee.

Events here are invented, in the platform's own shape. Nothing dials.
"""

from __future__ import annotations

import datetime as _dt
import json

from sticker.cli import main
from sticker.trace import WINDOW, Mark, Trace, render, turns

BASE = _dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=_dt.timezone.utc)


def ev(seconds: float, message: str) -> dict:
    stamp = (BASE + _dt.timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")
    return {"type": "call.in_progress", "created_at": stamp, "message": message, "details": {}}


def test_a_bot_turn_right_after_callee_speech_is_a_collision():
    trace = turns([
        ev(0, "Call connected."),
        ev(1.0, "Callee speech detected."),
        ev(1.4, "Bot is speaking: Hello?"),
        ev(6.0, "Bot is speaking: What is your cash price?"),
    ])
    assert trace.collisions == 1
    assert trace.first_collision == 1.4
    assert trace.bot_turns == 2 and trace.callee_turns == 1


def test_a_bot_turn_outside_the_window_is_not_a_collision():
    trace = turns([
        ev(0, "Call connected."),
        ev(1.0, "Callee said: Pharmacy, how can I help?"),
        ev(1.0 + WINDOW + 0.1, "Bot is speaking: Hi."),
    ])
    assert trace.collisions == 0


def test_time_zero_is_the_connect_event_not_the_first_speech():
    trace = turns([
        ev(5.0, "Call connected."),
        ev(7.5, "Bot is speaking: Hello?"),
    ])
    assert trace.marks == (Mark(t=2.5, channel="bot", collision=False),)


def test_without_a_connect_event_the_first_mark_is_zero():
    trace = turns([ev(9.0, "Callee speech detected."), ev(12.0, "Bot is speaking: Hi.")])
    assert [m.t for m in trace.marks] == [0.0, 3.0]
    assert trace.span == 3.0


def test_events_arrive_in_any_order():
    shuffled = [
        ev(4.0, "Bot is speaking: Hello?"),
        ev(0, "Call connected."),
        ev(3.2, "Callee speech detected."),
    ]
    assert turns(shuffled).collisions == 1


def test_a_call_with_no_speech_has_an_empty_trace():
    trace = turns([ev(0, "run_call started."), ev(3, "Call ended.")])
    assert trace == Trace(marks=(), span=0.0)
    assert render(trace).startswith("line never opened")


def test_render_marks_collisions_with_an_x_and_reports_the_count():
    trace = turns([
        ev(0, "Call connected."),
        ev(1.0, "Callee speech detected."),
        ev(1.4, "Bot is speaking: Hello?"),
        ev(20.0, "Bot is speaking: Goodbye."),
    ])
    text = render(trace, width=40, seconds=60)
    agent, callee = text.splitlines()[0], text.splitlines()[1]
    assert agent.startswith("agent") and "X" in agent and "|" in agent
    assert callee.startswith("callee") and "|" in callee
    assert "1 collisions over 20s" in text
    assert "first collision at 1.4s" in text


def test_cli_replays_a_saved_stream_without_a_key(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    saved = tmp_path / "events.json"
    saved.write_text(json.dumps({"data": [
        ev(0, "Call connected."),
        ev(2.0, "Callee speech detected."),
        ev(2.5, "Bot is speaking: Hello?"),
    ]}), encoding="utf-8")
    assert main(["trace", "--events", str(saved)]) == 0
    out = capsys.readouterr().out
    assert "3 events" in out and "1 collisions" in out


def test_cli_refuses_without_exactly_one_source(capsys):
    assert main(["trace"]) == 2
    assert main(["trace", "--call-id", "call_x", "--events", "x.json"]) == 2


def test_cli_by_call_id_needs_a_key(monkeypatch, capsys):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    assert main(["trace", "--call-id", "call_sticker_credential_probe"]) == 2
    assert "CALLE_API_KEY is not set" in capsys.readouterr().err
