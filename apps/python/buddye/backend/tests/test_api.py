"""The HTTP surface, driven the way the UI drives it.

Every test runs inside `app.router.lifespan_context`, so the app is exercised with the real startup
path — preflight validation, `init_db`, seeding, sweep resumption — rather than against handlers
called in isolation. That is deliberate: startup is where regressions
surface first, and a suite that never boots the app would not notice.
"""
from __future__ import annotations

import asyncio

import pytest

from tests.conftest import wait_sweeps

pytestmark = pytest.mark.usefixtures("db")

CAPTAIN = "Alma Reyes"


async def _hazard(c):  # noqa: ANN001, ANN202
    rows = (await c.get("/api/hazards")).json()
    return next(h for h in rows if h["kind"] == "heat")


async def _swept(c):  # noqa: ANN001, ANN202
    """Run one full sweep of the seeded block and hand back the hazard it swept."""
    hazard = await _hazard(c)
    await c.post(f"/api/hazards/{hazard['id']}/sweep")
    await wait_sweeps()
    return hazard


# ------------------------------------------------------------------------------------------------
async def test_starting_a_sweep_twice_starts_one_sweep(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _hazard(c)
            a, b = await asyncio.gather(
                c.post(f"/api/hazards/{hazard['id']}/sweep"),
                c.post(f"/api/hazards/{hazard['id']}/sweep"),
            )
            assert a.status_code == 202 and b.status_code == 202
            assert a.json()["sweep_id"] == b.json()["sweep_id"]
            assert {a.json()["created"], b.json()["created"]} == {True, False}
            await wait_sweeps()

            sweeps = (await c.get(f"/api/hazards/{hazard['id']}/sweeps")).json()
            assert len(sweeps) == 1
            assert sweeps[0]["state"] == "COMPLETE"
            assert sweeps[0]["calls_made"] == 18  # 13 neighbours + 5 emergency contacts
            assert len(sweeps[0]["outcomes"]) == 13
            assert [p["name"] for p in sweeps[0]["unaccounted"]] == ["Gerald Pryce"]


async def test_the_roster_carries_each_persons_risk_under_the_named_hazard(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _hazard(c)
            rows = (await c.get("/api/neighbours", params={"hazard_id": hazard["id"]})).json()

            assert len(rows) == 14
            assert rows[0]["name"] == "Rosa Delgado" and rows[0]["risk"]["band"] == "critical"
            assert rows[0]["risk"]["reasons"]                       # why, in sentences
            assert all(r["phone_masked"].startswith("*") for r in rows)

            # The neighbour who opted out is on the captain's board and is not on the call list.
            gerald = next(r for r in rows if r["name"] == "Gerald Pryce")
            assert gerald["check_in_consent"] is False
            assert gerald["risk"]["may_call"] is False and gerald["risk"]["skip_reason"]

            # Without a hazard there is no risk to report: triage is about a person under a hazard.
            plain = (await c.get("/api/neighbours")).json()
            assert all(r["risk"] is None for r in plain)


async def test_declaring_the_outage_reorders_the_block_live(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            heat = await _hazard(c)
            heat_rows = (await c.get("/api/neighbours", params={"hazard_id": heat["id"]})).json()

            outage = (await c.post("/api/demo/outage")).json()
            outage_rows = (await c.get("/api/neighbours", params={"hazard_id": outage["hazard_id"]})).json()

            assert heat_rows[0]["name"] == "Rosa Delgado"
            assert outage_rows[0]["name"] == "Walter Brzezinski"  # the concentrator runs on wall power
            assert outage_rows[0]["risk"]["time_to_harm_h"] == 4.0
            assert (await c.post("/api/demo/outage")).json()["hazard_id"] == outage["hazard_id"]  # idempotent


async def test_the_contract_preview_compiles_without_dialing_anyone(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _hazard(c)
            preview = (await c.get(f"/api/hazards/{hazard['id']}/contract")).json()

            assert preview["neighbour"]["name"] == "Rosa Delgado"
            assert preview["contract"]["hard_fields"]
            assert preview["contract"]["result_schema"]["additionalProperties"] is False
            assert (await c.get("/api/health")).json()["calls_recorded"] == 0  # nothing was placed


async def test_the_stream_replays_from_any_point(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _swept(c)
            history = (await c.get(f"/api/stream/hazards/{hazard['id']}/history")).json()
            ids = [e["id"] for e in history]

            assert ids == sorted(ids)
            assert history[0]["type"] == "sweep.created"
            assert {"sweep.triaged", "check.decided", "escalation.opened", "handoff.prepared"} <= {e["type"] for e in history}
            later = (await c.get(f"/api/stream/hazards/{hazard['id']}/history",
                                 params={"since_event_id": ids[5]})).json()
            assert [e["id"] for e in later] == ids[6:]


async def test_the_dashboard_counts_what_the_evening_produced(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            await _swept(c)
            dash = (await c.get("/api/dashboard")).json()

            assert dash["neighbours"] == 14 and dash["consenting"] == 13
            assert dash["calls_made"] == 18
            assert sum(dash["outcome_counts"].values()) == 13
            assert dash["unaccounted"] == 1              # Gerald, and the board says so
            assert dash["handoffs_prepared"] >= 1
            assert dash["handoffs_released"] == 0        # the machine released nothing
            assert dash["real_calls_used"] == 0 and dash["provider"] == "mock"
            assert dash["block_captain"] == CAPTAIN


# ------------------------------------------------------------------------------------------------
# The human-in-the-loop endpoints
# ------------------------------------------------------------------------------------------------
async def test_a_handoff_packet_cannot_be_released_without_a_named_human(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _swept(c)
            packets = (await c.get("/api/handoffs", params={"hazard_id": hazard["id"]})).json()
            assert packets, "the sweep should have prepared at least one responder handoff"

            packet = packets[0]
            assert packet["released"] is False
            assert "no emergency service has been contacted" in packet["status_note"]

            url = f"/api/handoffs/{packet['id']}/release"
            assert (await c.post(url, json={})).status_code == 422                    # no name at all
            assert (await c.post(url, json={"released_by": ""})).status_code == 400   # blank
            assert (await c.post(url, json={"released_by": "system"})).status_code == 400
            assert (await c.post(url, json={"released_by": "automation"})).status_code == 400
            assert (await c.get(f"/api/handoffs/{packet['id']}")).json()["released"] is False

            ok = await c.post(url, json={"released_by": CAPTAIN, "note": "ringing it in myself"})
            assert ok.status_code == 200
            body = ok.json()
            assert body["released"] is True and body["released_by"] == CAPTAIN
            assert body["spoken_script"] and body["neighbour_snapshot"]["address"]

            # Once released, released. A second attempt is refused rather than restamped.
            assert (await c.post(url, json={"released_by": "Someone Else"})).status_code == 400
            assert (await c.get(f"/api/handoffs/{packet['id']}")).json()["released_by"] == CAPTAIN

            stream = (await c.get(f"/api/stream/hazards/{hazard['id']}/history")).json()
            assert any(e["type"] == "handoff.released" for e in stream)


async def test_escalations_list_the_ladder_and_close_with_a_name(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _swept(c)
            rows = (await c.get("/api/escalations", params={"hazard_id": hazard["id"]})).json()
            assert rows

            hazel = next(r for r in rows if r["name"] == "Hazel Nakamura")
            assert hazel["outcome"] == "UNREACHABLE"
            assert hazel["status"] == "CONTACT_REACHED"
            assert [r["action"] for r in hazel["rungs"]][:2] == ["entered", "called"]

            url = f"/api/escalations/{hazel['id']}/resolve"
            assert (await c.post(url, json={"resolved_by": " "})).status_code == 400
            done = await c.post(url, json={"resolved_by": CAPTAIN, "note": "her son is with her"})
            assert done.status_code == 200 and done.json()["status"] == "RESOLVED"
            assert done.json()["resolved_by"] == CAPTAIN

            still_open = (await c.get("/api/escalations", params={"hazard_id": hazard["id"], "open_only": True})).json()
            assert hazel["id"] not in {r["id"] for r in still_open}


async def test_the_trace_is_the_whole_evening_in_one_document(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _swept(c)
            sweep_id = (await c.get(f"/api/hazards/{hazard['id']}/sweeps")).json()[0]["sweep_id"]
            doc = (await c.get(f"/api/sweeps/{sweep_id}/trace")).json()

            assert doc["sweep"]["state"] == "COMPLETE"
            assert len(doc["calls"]) == 18
            assert doc["triage"][0]["name"] == "Rosa Delgado"
            assert [u["name"] for u in doc["unaccounted"]] == ["Gerald Pryce"]

            # What we sent and what came back, per call — the point of the document.
            rosa = next(x for x in doc["calls"] if x["neighbour"] == "Rosa Delgado")
            assert rosa["sent"]["task"] and rosa["sent"]["result_schema"]["properties"]
            assert rosa["sent"]["risk_snapshot"]["band"] == "critical"
            assert rosa["returned"]["transcript"] and rosa["processing"]["outcome"] == "URGENT"
            assert rosa["provider_events"]

            # The claim the design makes, asserted on the artifact that would prove it wrong.
            assert doc["safety"]["handoffs_prepared"] >= 1
            assert doc["safety"]["handoffs_released"] == 0
            assert doc["safety"]["emergency_services_contacted"] == 0

            assert (await c.get("/api/sweeps/does_not_exist/trace")).status_code == 404


async def test_one_neighbours_page_shows_calls_ladder_and_packet(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _swept(c)
            rows = (await c.get("/api/neighbours", params={"hazard_id": hazard["id"]})).json()
            benny = next(r for r in rows if r["name"] == "Benny Okonkwo")

            detail = (await c.get(f"/api/neighbours/{benny['id']}", params={"hazard_id": hazard["id"]})).json()
            assert detail["neighbour"]["risk"]["band"] in {"high", "critical"}
            assert [c_["callee"] for c_ in detail["calls"]] == ["neighbour", "emergency_contact"]
            assert detail["escalations"][0]["level"] == "RESPONDER"
            assert detail["handoffs"] and detail["handoffs"][0]["released"] is False


# ------------------------------------------------------------------------------------------------
# Housekeeping the demo depends on
# ------------------------------------------------------------------------------------------------
async def test_reset_reseeds_and_cancels_a_sweep_in_flight(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            hazard = await _hazard(c)
            await c.post(f"/api/hazards/{hazard['id']}/sweep")
            reset = (await c.post("/api/demo/reset")).json()
            await wait_sweeps()

            assert reset["ok"] and reset["neighbours"] == 14
            assert reset["hazard_id"] != hazard["id"]  # a fresh block, freshly declared
            dash = (await c.get("/api/dashboard")).json()
            assert dash["neighbours"] == 14 and dash["real_calls_used"] == 0


async def test_webhook_checks_its_token_its_header_and_its_own_receipts(client) -> None:  # noqa: ANN001
    from app.config import get_settings
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            secret = get_settings().CALLE_WEBHOOK_SECRET
            body = {"id": "evt_1", "type": "call.completed", "data": {"id": "call_unknown"}}

            assert (await c.post("/api/calle/webhook/wrong-token", json=body)).status_code == 404
            bad_header = await c.post(f"/api/calle/webhook/{secret}", json=body,
                                      headers={"CALL-E-Event-Id": "evt_other"})
            assert bad_header.status_code == 400

            first = await c.post(f"/api/calle/webhook/{secret}", json=body, headers={"CALL-E-Event-Id": "evt_1"})
            assert first.status_code == 200 and first.json()["unknown_call"] is True
            second = await c.post(f"/api/calle/webhook/{secret}", json=body, headers={"CALL-E-Event-Id": "evt_1"})
            assert second.json()["duplicate"] is True  # an event id is processed exactly once


async def test_status_endpoint_reports_the_wiring_without_placing_a_call(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            status = (await c.get("/api/calle/status")).json()
            assert status["provider"] == "mock" and status["ready"] is True
            assert status["live"] is False
            assert status["budget"]["used"] == 0
            assert (await c.get("/api/health")).json()["calls_recorded"] == 0


async def test_unknown_ids_are_404s_not_500s(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            assert (await c.get("/api/hazards/nope")).status_code == 404
            assert (await c.post("/api/hazards/nope/sweep")).status_code == 404
            assert (await c.get("/api/neighbours/nope")).status_code == 404
            assert (await c.get("/api/escalations/nope")).status_code == 404
            assert (await c.get("/api/handoffs/nope")).status_code == 404
            assert (await c.post("/api/handoffs/nope/release", json={"released_by": CAPTAIN})).status_code == 404


async def test_declaring_a_hazard_does_not_call_anybody(client) -> None:  # noqa: ANN001
    from app.main import app

    async with app.router.lifespan_context(app):
        async with await client() as c:
            created = await c.post("/api/hazards", json={
                "kind": "boil_water", "headline": "Boil water notice — main break on 51st Ave",
                "severity": "advisory", "facts": {"note": "city main break"},
            })
            assert created.status_code == 201
            hazard = created.json()
            assert hazard["status"] == "OPEN" and hazard["declared_by"] == CAPTAIN
            assert hazard["active_sweep_id"] is None
            assert hazard["profile"]["describe"]
            assert (await c.get("/api/health")).json()["calls_recorded"] == 0
