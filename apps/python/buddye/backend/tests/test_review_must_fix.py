"""The three Must Fix items from the maintainer review of this app, pinned one section each.

1. **Local-only.** The API answers loopback, untunnelled requests only. The CALL-E webhook is the one
   exemption, and it still refuses a wrong token itself.
2. **Authorised recipients, approved origin.** A real provider dials only strict ASCII E.164 numbers
   that are in `DIALABLE_NUMBERS`, and no budget setting changes that. The API key is only ever sent to
   `https://api.heycall-e.com`.
3. **Unknown stays unknown.** An ambiguous create or a poll deadline is `UNKNOWN`, the roster stops
   before any escalation or another call, and a missing provider id is never read as "nobody was
   rung". A definite 4xx refusal is still reported as "no call was placed".

Mock provider, fake SDK clients and in-process ASGI only. Nothing here reaches a network or a phone.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from sqlmodel import select

from app.calls.budget import CallBudget
from app.calls.calle_sdk import CalleSdkProvider
from app.calls.guards import OFFICIAL_CALLE_ORIGIN, UnapprovedBaseUrl, approved_calle_base_url, is_strict_e164
from app.calls.mock import MockCallProvider
from app.calls.preflight import validate_startup
from app.calls.provider import CallOutcome, CallRequest, NumberNotAllowlisted
from app.config import Settings, get_settings
from app.db import session_scope
from app.domain.state import SweepState
from app.models import CheckCall, Escalation, Hazard, Incident, Neighbour
from app.orchestrator.reconcile import NullReconciler
from app.orchestrator.sweep import OUTCOME_UNKNOWN_REASON
from tests.helpers import (
    calls_of,
    escalations_of,
    events_of,
    get_sweep,
    make_sweep,
    neighbour_named,
    outcomes_by_name,
    packets_of,
    run_sweep,
    settings_with,
)

pytestmark = pytest.mark.usefixtures("db")


# ================================================================================================
# 1. Local-only
# ================================================================================================
def _client(peer: str = "127.0.0.1", base: str = "http://127.0.0.1:8000"):  # noqa: ANN202
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app, client=(peer, 50000)), base_url=base)


OPERATOR_AND_RECORD_ENDPOINTS = [
    ("GET", "/api/health"),
    ("GET", "/api/dashboard"),
    ("GET", "/api/neighbours"),
    ("GET", "/api/cases/hz_x/nbr_x"),
    ("POST", "/api/cases/hz_x/nbr_x/call"),
    ("POST", "/api/hazards/hz_x/sweep"),
    ("POST", "/api/handoffs/pkt_x/release"),
    ("POST", "/api/demo/reset"),
    ("GET", "/api/stream/hazards/hz_x/history"),
    ("GET", "/api/calle/status"),
]


async def test_a_loopback_request_is_served() -> None:
    async with _client() as c:
        assert (await c.get("/api/health")).status_code == 200
    async with _client(peer="::1", base="http://localhost:8000") as c:
        assert (await c.get("/api/health", headers={"Origin": "http://localhost:5173"})).status_code == 200


@pytest.mark.parametrize(
    ("peer", "base", "headers"),
    [
        ("203.0.113.7", "http://127.0.0.1:8000", {}),                                  # LAN / internet peer
        ("127.0.0.1", "http://buddye.example.com", {}),                                # DNS-rebinding Host
        ("127.0.0.1", "http://127.0.0.1:8000", {"X-Forwarded-For": "203.0.113.7"}),    # tunnel / proxy
        ("127.0.0.1", "http://127.0.0.1:8000", {"Forwarded": "for=203.0.113.7"}),
        ("127.0.0.1", "http://127.0.0.1:8000", {"CF-Connecting-IP": "203.0.113.7"}),
        ("127.0.0.1", "http://127.0.0.1:8000", {"Origin": "https://attacker.example"}),  # cross-site page
    ],
    ids=["remote-peer", "foreign-host", "x-forwarded-for", "forwarded", "cf-connecting-ip", "foreign-origin"],
)
async def test_non_local_requests_are_refused_everywhere_but_the_webhook(peer: str, base: str, headers: dict[str, str]) -> None:
    async with _client(peer, base) as c:
        for method, path in OPERATOR_AND_RECORD_ENDPOINTS:
            response = await c.request(method, path, headers=headers)
            assert response.status_code == 403, (method, path, response.status_code)
            assert "local-only" in response.json()["detail"]


async def test_the_calle_webhook_is_the_only_path_a_tunnel_reaches() -> None:
    async with _client("203.0.113.7", "https://abc.tunnel.example") as c:
        tunnelled = {"X-Forwarded-For": "203.0.113.7"}
        # Reaches the handler, which refuses the wrong path token itself.
        assert (await c.post("/api/calle/webhook/not-the-token", json={"id": "evt_1"}, headers=tunnelled)).status_code == 404
        # Only a POST to that exact path is exempt.
        assert (await c.get("/api/calle/webhook/not-the-token", headers=tunnelled)).status_code == 403
        assert (await c.post("/api/calle/webhook/a/b", headers=tunnelled)).status_code == 403


# ================================================================================================
# 2. Authorised ASCII E.164 recipients, approved HTTPS origin
# ================================================================================================
@pytest.mark.parametrize("phone", ["+15550100", "+442079460000", "+15"])
def test_strict_e164_accepts_plain_numbers(phone: str) -> None:
    assert is_strict_e164(phone)


@pytest.mark.parametrize(
    "phone",
    ["15550100", "+1 555 0100", "+1-555-0100", "+1(555)0100", "+15550100\n", " +15550100", "+15550100x12",
     "+１５５５０１００", "+١٥٥٥٠١٠٠", "+0155501", "+1", "+1234567890123456", "", None],
)
def test_strict_e164_refuses_anything_that_would_need_tidying(phone: Any) -> None:
    assert not is_strict_e164(phone)


def test_the_allowlist_holds_with_no_switch_to_turn_it_off(monkeypatch: pytest.MonkeyPatch) -> None:
    # The old CALL_BUDGET_ENFORCE switch disabled the allowlist. It no longer exists, and setting it
    # in the environment changes nothing.
    monkeypatch.setenv("CALL_BUDGET_ENFORCE", "false")
    fresh = Settings(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS="+15550100", CALL_BUDGET_MAX=99)
    assert not hasattr(fresh, "CALL_BUDGET_ENFORCE")
    budget = CallBudget(fresh)
    with session_scope() as s:
        budget.reserve(s, phone="+15550100", provider="calle_sdk")        # authorised: no raise
        with pytest.raises(NumberNotAllowlisted):
            budget.reserve(s, phone="+15550199", provider="calle_sdk")    # not listed
        with pytest.raises(NumberNotAllowlisted):
            budget.reserve(s, phone="+15550100 ", provider="calle_sdk")   # listed once tidied: still no


def test_a_listed_but_malformed_number_is_refused_and_stops_startup() -> None:
    settings = settings_with(CALL_PROVIDER="calle_sdk", CALLE_API_KEY="sk_test_not_real",
                             DIALABLE_NUMBERS="+15550100,+1 555 0101", CALL_BUDGET_MAX=99)
    with session_scope() as s, pytest.raises(NumberNotAllowlisted, match="E.164"):
        CallBudget(settings).reserve(s, phone="+1 555 0101", provider="calle_sdk")
    assert any("ASCII E.164" in p for p in validate_startup(settings))


@pytest.mark.parametrize(
    "url",
    ["https://attacker.example", "http://api.heycall-e.com", "https://api.heycall-e.com.attacker.example",
     "https://user:pw@api.heycall-e.com", "https://api.heycall-e.com/v1", "https://api.heycall-e.com:8443",
     "https://api.heycall-e.com?next=x", "ftp://api.heycall-e.com", "https://[::1"],
)
def test_an_unapproved_calle_base_url_is_refused(url: str) -> None:
    with pytest.raises(UnapprovedBaseUrl):
        approved_calle_base_url(url)
    problems = validate_startup(settings_with(CALL_PROVIDER="calle_sdk", CALLE_API_KEY="sk_test_not_real",
                                              DIALABLE_NUMBERS="+15550100", CALLE_BASE_URL=url))
    assert any("CALLE_BASE_URL" in p for p in problems)


@pytest.mark.parametrize("url", ["https://api.heycall-e.com", "https://api.heycall-e.com/", "", None])
def test_the_official_origin_is_accepted(url: str | None) -> None:
    assert approved_calle_base_url(url) == OFFICIAL_CALLE_ORIGIN


def test_the_sdk_provider_refuses_an_unapproved_origin_before_a_keyed_client_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    import calle

    built: list[dict[str, Any]] = []
    monkeypatch.setattr(calle, "CalleClient", lambda **kw: built.append(kw) or SimpleNamespace())
    with pytest.raises(UnapprovedBaseUrl):
        CalleSdkProvider(settings_with(CALLE_API_KEY="sk_test_not_real", CALLE_BASE_URL="https://attacker.example"))
    assert built == []
    CalleSdkProvider(settings_with(CALLE_API_KEY="sk_test_not_real"))
    assert built[0]["base_url"] == OFFICIAL_CALLE_ORIGIN


# ================================================================================================
# 3. Ambiguous creation and poll deadlines stay unknown and stop the roster
# ================================================================================================
class _ApiError(Exception):
    def __init__(self, status_code: int, code: str | None = None) -> None:
        super().__init__(f"{status_code} {code}")
        self.status_code = status_code
        self.code = code


class _FakeCalls:
    def __init__(self, *, create: Any = None, get: Any = None) -> None:
        self._create, self._get = create, get

    def create(self, **kwargs: Any) -> Any:
        if isinstance(self._create, BaseException):
            raise self._create
        return self._create

    def get(self, call_id: str) -> Any:
        if isinstance(self._get, BaseException):
            raise self._get
        return self._get(call_id)

    def list_events(self, call_id: str, cursor: str | None = None) -> dict[str, Any]:
        return {"data": []}


def _sdk(calls: _FakeCalls, *, deadline_s: float = 5.0) -> CalleSdkProvider:
    settings = SimpleNamespace(CALLE_POLL_INTERVAL_S=0.01, CALLE_CALL_TIMEOUT_S=deadline_s)
    return CalleSdkProvider(settings, client=SimpleNamespace(calls=calls))  # type: ignore[arg-type]


def _request() -> CallRequest:
    return CallRequest(phone="+15550100", task="t", result_schema={}, idempotency_key="k", neighbour_id="nbr_test")


async def _sink(ev: Any) -> None:
    return None


@pytest.mark.parametrize(
    "exc",
    [TimeoutError("timed out"), ConnectionResetError("reset"), _ApiError(503, "provider_unavailable"),
     _ApiError(500, "internal_error"), _ApiError(408), ValueError("unreadable body")],
    ids=["timeout", "connection", "503", "500", "408", "not-an-http-answer"],
)
async def test_an_ambiguous_create_is_unknown_not_failed(exc: Exception) -> None:
    outcome = await _sdk(_FakeCalls(create=exc)).place(_request(), _sink)
    assert outcome.status == "UNKNOWN"
    assert outcome.provider_call_id is None


async def test_a_create_answer_with_no_call_id_is_unknown() -> None:
    outcome = await _sdk(_FakeCalls(create={"status": "queued"})).place(_request(), _sink)
    assert outcome.status == "UNKNOWN"


async def test_a_definite_refusal_is_still_reported_as_no_call_placed() -> None:
    from app.orchestrator.decide import decide

    outcome = await _sdk(_FakeCalls(create=_ApiError(429, "rate_limit_exceeded"))).place(_request(), _sink)
    assert outcome.status == "FAILED"
    assert "no call was placed" in decide(status=outcome.status, result=None, placed=False).reason


async def test_a_poll_deadline_is_unknown_not_failed() -> None:
    calls = _FakeCalls(create={"id": "call_1", "status": "queued"}, get=lambda cid: {"id": cid, "status": "in_progress"})
    outcome = await _sdk(calls, deadline_s=0.05).place(_request(), _sink)
    assert (outcome.status, outcome.provider_call_id) == ("UNKNOWN", "call_1")


async def test_a_poll_deadline_while_status_checks_keep_failing_is_unknown() -> None:
    calls = _FakeCalls(create={"id": "call_1", "status": "queued"}, get=TimeoutError("status check timed out"))
    outcome = await _sdk(calls, deadline_s=0.05).place(_request(), _sink)
    assert (outcome.status, outcome.provider_call_id) == ("UNKNOWN", "call_1")


async def test_the_mcp_provider_treats_a_run_with_no_run_id_as_unknown() -> None:
    from app.calls.calle_mcp import CalleMcpProvider

    def cli(argv: list[str]) -> dict[str, Any]:
        if "plan" in argv:
            return {"ok": True, "result": {"structuredContent": {"plan_id": "p1", "confirm_token": "c", "ready_to_run": True}}}
        return {"ok": False, "message": "timed out waiting for the server"}

    provider = CalleMcpProvider(settings_with(CALLE_CLI_BIN="calle-not-installed"), runner=cli)
    outcome = await provider.place(_request(), _sink)
    assert (outcome.status, outcome.provider_call_id) == ("UNKNOWN", None)


# --- the runner -----------------------------------------------------------------------------------
class _LosesSightOf(MockCallProvider):
    """The mock, except the calls to `names` come back UNKNOWN (or raise mid-dial)."""

    def __init__(self, names: set[str], *, name: str = "mock", raises: bool = False, **kw: Any) -> None:
        super().__init__(delay_s=0, **kw)
        self.names, self.raises = names, raises
        self.name = name

    async def place(self, req: CallRequest, on_event: Any) -> CallOutcome:
        meta = req.metadata or {}
        who = meta.get("neighbour_name") if meta.get("callee") == "neighbour" else meta.get("contact_name")
        if who in self.names:
            self.placed.append(req)
            if self.raises:
                raise TimeoutError("the provider hung mid-create")
            return CallOutcome(provider_call_id=None, status="UNKNOWN", structured_result=None,
                               failure_code="create_outcome_unknown", failure_message="create timed out")
        return await super().place(req, on_event)


def _call_order(hazard_id: str) -> list[str]:
    from app.domain.risk import triage
    from app.orchestrator.sweep import load_roster

    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        roster = load_roster(s)
        names = {n.id: n.name for n in roster}
        return [names[a.neighbour_id] for a in triage(roster, hazard) if a.may_call]


def _live_settings(hazard_id: str) -> Settings:
    with session_scope() as s:
        phones = [n.phone for n in s.exec(select(Neighbour)).all()]
    return settings_with(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS=",".join(phones), CALL_BUDGET_MAX=99)


def _neighbours_dialled(provider: MockCallProvider) -> list[str]:
    return [r.metadata["neighbour_name"] for r in provider.placed if r.metadata.get("callee") == "neighbour"]


async def test_an_unknown_outcome_stops_the_roster_before_escalation_or_another_call(seeded: str) -> None:
    order = _call_order(seeded)
    target = order[2]
    provider = _LosesSightOf({target})
    sweep_id = await run_sweep(seeded, provider=provider)

    sweep = get_sweep(sweep_id)
    assert SweepState(sweep.state) is SweepState.FAILED        # terminal: a restart will not resume it
    assert "outcome unknown" in (sweep.error or "")
    assert _neighbours_dialled(provider) == order[:3]         # nobody after them was rung
    assert target not in outcomes_by_name(sweep_id)           # no finding invented about them
    target_id = neighbour_named(target).id
    assert all(e.neighbour_id != target_id for e in escalations_of(sweep_id))  # and no ladder
    [row] = [c for c in calls_of(sweep_id) if c.neighbour_id == target_id]
    assert row.status == "UNKNOWN" and row.outcome is None

    decided = [e["payload"]["neighbour_id"] for e in events_of(seeded, type="check.decided")]
    assert target_id not in decided
    assert len(events_of(seeded, type="sweep.halted_outcome_unknown")) == 1
    [unaccounted] = [e["payload"] for e in events_of(seeded, type="sweep.unaccounted")]
    kinds = {p["name"]: p["kind"] for p in unaccounted["people"]}
    assert kinds[target] == "outcome_unknown"
    assert all(kinds[name] == "not_dialled" for name in order[3:])


async def test_a_provider_that_raises_mid_dial_is_unknown_too(seeded: str) -> None:
    order = _call_order(seeded)
    provider = _LosesSightOf({order[0]}, name="calle_sdk", raises=True)
    sweep_id = await run_sweep(seeded, provider=provider, settings=_live_settings(seeded))

    assert SweepState(get_sweep(sweep_id).state) is SweepState.FAILED
    assert _neighbours_dialled(provider) == order[:1]
    assert [c.status for c in calls_of(sweep_id)] == ["UNKNOWN"]
    assert escalations_of(sweep_id) == []


async def test_an_unknown_emergency_contact_call_stops_the_ladder_and_the_roster(seeded: str) -> None:
    order = _call_order(seeded)
    benny = neighbour_named("Benny Okonkwo")   # not reached, so the ladder rings his contact
    assert benny.contact_name
    provider = _LosesSightOf({benny.contact_name})
    sweep_id = await run_sweep(seeded, provider=provider)

    assert SweepState(get_sweep(sweep_id).state) is SweepState.FAILED
    dialled = _neighbours_dialled(provider)
    assert dialled[-1] == "Benny Okonkwo"
    assert dialled == order[: order.index("Benny Okonkwo") + 1]
    assert all(p.neighbour_id != benny.id for p in packets_of(sweep_id))   # no responder packet cut
    [esc] = [e for e in escalations_of(sweep_id) if e.neighbour_id == benny.id]
    assert any("outcome unknown" in str(rung) for rung in esc.rungs)


async def test_a_restart_that_finds_a_dial_with_no_provider_id_does_not_dial_again(seeded: str) -> None:
    from app.orchestrator.runner import Runner

    settings = _live_settings(seeded)
    order = _call_order(seeded)
    first = neighbour_named(order[0])
    sweep_id = make_sweep(seeded, provider="calle_sdk")
    with session_scope() as s:  # what a crash between our row and CALL-E's answer leaves behind
        s.add(CheckCall(sweep_id=sweep_id, hazard_id=seeded, neighbour_id=first.id, callee="neighbour", attempt=1,
                        idempotency_key=f"{sweep_id}:{first.id}:neighbour:1", provider="calle_sdk",
                        status="DIALING", task="t", result_schema={}))

    provider = _LosesSightOf(set(), name="calle_sdk")
    await Runner(sweep_id, settings=settings, provider=provider, reconciler=NullReconciler()).run()

    assert provider.placed == []                                  # the create was not sent a second time
    assert SweepState(get_sweep(sweep_id).state) is SweepState.FAILED
    assert [c.status for c in calls_of(sweep_id)] == ["UNKNOWN"]


async def test_nobody_rings_a_person_with_an_unknown_call_again(seeded: str) -> None:
    from app.api.cases import _callable_now

    order = _call_order(seeded)
    target = order[0]
    await run_sweep(seeded, provider=_LosesSightOf({target}))

    # A fresh sweep of the same block skips them, visibly, and carries on with everyone else.
    again = MockCallProvider(delay_s=0)
    second = await run_sweep(seeded, provider=again)
    assert target not in _neighbours_dialled(again)
    assert len(_neighbours_dialled(again)) == len(order) - 1
    skipped = [e["payload"] for e in events_of(seeded, type="call.skipped") if e["payload"].get("name") == target]
    assert skipped and skipped[-1]["reason"] == OUTCOME_UNKNOWN_REASON
    assert target not in outcomes_by_name(second)

    # And the case page will not ring them either.
    with session_scope() as s:
        nbr = s.exec(select(Neighbour).where(Neighbour.name == target)).one()
        gate = _callable_now(s, nbr, get_settings())
    assert gate == {**gate, "allowed": False, "reason": OUTCOME_UNKNOWN_REASON}


async def test_a_case_call_with_an_unknown_outcome_opens_nothing(seeded: str) -> None:
    from app.api.cases import launch_call

    rosa = neighbour_named("Rosa Delgado")
    out = await launch_call(seeded, rosa.id, settings=get_settings(), provider=_LosesSightOf({"Rosa Delgado"}),
                            reconciler=NullReconciler())

    assert out["status"] == "outcome_unknown"
    with session_scope() as s:
        assert s.exec(select(Escalation).where(Escalation.neighbour_id == rosa.id)).all() == []
        assert s.exec(select(Incident).where(Incident.neighbour_id == rosa.id)).all() == []
        [row] = s.exec(select(CheckCall).where(CheckCall.neighbour_id == rosa.id)).all()
        assert row.status == "UNKNOWN"


# --- the budget cap cannot be overshot ------------------------------------------------------------
async def test_calls_in_flight_and_of_unknown_outcome_use_up_the_budget(seeded: str) -> None:
    from app.calls.budget import count_real_calls
    from app.calls.provider import CallBudgetExhausted

    order = _call_order(seeded)
    first, second = neighbour_named(order[0]), neighbour_named(order[1])
    settings = settings_with(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS=f"{first.phone},{second.phone}", CALL_BUDGET_MAX=2)
    sweep_id = make_sweep(seeded, provider="calle_sdk")
    with session_scope() as s:
        for nbr, status in ((first, "DIALING"), (second, "UNKNOWN")):  # neither has a provider id yet
            s.add(CheckCall(sweep_id=sweep_id, hazard_id=seeded, neighbour_id=nbr.id, callee="neighbour", attempt=1,
                            idempotency_key=f"{sweep_id}:{nbr.id}:neighbour:1", provider="calle_sdk",
                            status=status, task="t", result_schema={}))
        s.add(CheckCall(sweep_id=sweep_id, hazard_id=seeded, neighbour_id=first.id, callee="neighbour", attempt=2,
                        idempotency_key=f"{sweep_id}:{first.id}:neighbour:2", provider="calle_sdk",
                        status="FAILED", task="t", result_schema={}))  # a definite refusal: not counted
    with session_scope() as s:
        assert count_real_calls(s) == 2
        with pytest.raises(CallBudgetExhausted):
            CallBudget(settings).reserve(s, phone=first.phone, provider="calle_sdk")


async def test_calls_started_at_the_same_moment_cannot_overshoot_the_budget(seeded: str) -> None:
    import asyncio

    from app.api.cases import launch_call

    class _SlowCreate(MockCallProvider):
        """Like the real SDK: the provider call id only exists after the create request returns."""

        name = "calle_sdk"

        async def place(self, req: CallRequest, on_event: Any) -> CallOutcome:
            await asyncio.sleep(0.05)
            return await super().place(req, on_event)

    order = _call_order(seeded)
    people = [neighbour_named(name) for name in order[:3]]
    settings = settings_with(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS=",".join(p.phone for p in people), CALL_BUDGET_MAX=1)
    provider = _SlowCreate(delay_s=0)
    results = await asyncio.gather(*(launch_call(seeded, p.id, settings=settings, provider=provider,
                                                 reconciler=NullReconciler()) for p in people))

    assert len(provider.placed) == 1
    assert sorted(r["status"] for r in results) == ["completed", "refused", "refused"]
    assert all(r["budget_exhausted"] for r in results if r["status"] == "refused")
