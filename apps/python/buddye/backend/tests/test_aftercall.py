"""The work that follows a finished call must happen without anyone clicking, and must not stall.

Found in a live run: the call was read and the deployment case opened, but the situation brief
waited until someone opened the case page and the ICS-214 log waited for a button the console no
longer showed. During an incident nobody has a free hand for either.
"""
from __future__ import annotations

from typing import Any

from app.orchestrator import aftercall


async def test_after_a_call_the_brief_and_the_activity_log_are_both_written(db, monkeypatch) -> None:  # noqa: ANN001
    from app.api import cases
    from app.api import incidents as incidents_api

    briefs: list[tuple[str, str, str]] = []
    forms: list[dict[str, Any]] = []
    published: list[str] = []

    async def fake_brief(hazard_id: str, neighbour_id: str, call_id: str) -> None:
        briefs.append((hazard_id, neighbour_id, call_id))

    async def fake_document(body: Any, settings: Any) -> dict[str, Any]:
        forms.append({"form": body.form, "incident_id": body.incident_id, "prepared_by": body.prepared_by})
        return {"id": "doc_1", "form": body.form}

    monkeypatch.setattr(cases, "_write_brief", fake_brief)
    monkeypatch.setattr(incidents_api, "generate_document_record", fake_document)
    monkeypatch.setattr(aftercall.bus, "publish", lambda **kw: published.append(kw["type"]))

    done = await aftercall.run("haz_1", "nbr_1", "call_1", "inc_1")

    assert briefs == [("haz_1", "nbr_1", "call_1")]
    assert forms and forms[0]["form"] == "ICS-214" and forms[0]["incident_id"] == "inc_1"
    assert done == {"brief": True, "activity_log": "doc_1"}
    assert published[0] == "aftercall.started" and published[-1] == "aftercall.finished"


async def test_one_failing_step_does_not_cost_the_next(db, monkeypatch) -> None:  # noqa: ANN001
    """A model timeout on the brief must not take the activity log with it."""
    from app.api import cases
    from app.api import incidents as incidents_api

    async def broken_brief(*_: Any) -> None:
        raise TimeoutError("gateway timed out")

    async def fake_document(body: Any, settings: Any) -> dict[str, Any]:
        return {"id": "doc_2", "form": body.form}

    monkeypatch.setattr(cases, "_write_brief", broken_brief)
    monkeypatch.setattr(incidents_api, "generate_document_record", fake_document)
    monkeypatch.setattr(aftercall.bus, "publish", lambda **kw: None)

    done = await aftercall.run("haz_1", "nbr_1", "call_1", "inc_1")
    assert done == {"brief": False, "activity_log": "doc_2"}


async def test_the_brief_event_uses_the_bus_signature(db, monkeypatch) -> None:  # noqa: ANN001
    """`bus.publish` is keyword-only. A positional call raised TypeError after the model had already
    answered, so every brief was written but its live event never reached the console."""
    import inspect

    from app.events.bus import bus

    params = inspect.signature(bus.publish).parameters
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for name, p in params.items() if name != "self")
    src = inspect.getsource(__import__("app.api.cases", fromlist=["_write_brief"])._write_brief)
    assert 'type="case.brief"' in src
