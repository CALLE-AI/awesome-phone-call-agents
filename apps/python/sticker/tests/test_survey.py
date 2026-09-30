"""The survey, end to end, with no network and no credentials.

The transport under test is the real one. Only the wire is simulated, so these tests
exercise the same request building, idempotency header, polling loop and error mapping
that a live run uses.
"""

from __future__ import annotations

import datetime as _dt

import httpx
import pytest

from sticker.call_design import RECIPIENT_SCHEMA, DrugRequest, build_task
from sticker.calle import CalleAmbiguous, CalleError, CalleTransport, idempotency_key
from sticker.cli import main
from sticker.nadac import NadacRow
from sticker.pharmacies import Pharmacy, _dedupe_key
from sticker.report import Quote, Survey, render_text
from sticker.simulation import (
    SIMULATED_BASE_URL,
    SIMULATED_POLL_SECONDS,
    ScriptedAnswer,
    SimulatedCalle,
)
from sticker.survey import run_survey

DRUG = DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30)


def _pharmacy(index: int) -> Pharmacy:
    return Pharmacy(
        npi=f"000000{index:04d}",
        name=f"Example Pharmacy {index}",
        phone=f"202-555-{100 + index:04d}",
        address=f"{index} Example Street",
        city="Springfield",
        state="EX",
        postal_code="00000",
    )


def _transport(sim: SimulatedCalle) -> CalleTransport:
    return CalleTransport(
        api_key="simulated",
        base_url=SIMULATED_BASE_URL,
        transport=sim.transport(),
        poll_interval=SIMULATED_POLL_SECONDS,
    )


async def _run(sim: SimulatedCalle, count: int) -> Survey:
    return await run_survey(
        drug=DRUG,
        postal_code="00000",
        pharmacies=[_pharmacy(i) for i in range(count)],
        transport=_transport(sim),
        caller_org="an independent price comparison",
        live=False,
        fetch_nadac=False,
    )


# -- the transport ---------------------------------------------------------------


async def test_a_call_goes_out_and_a_price_comes_back() -> None:
    sim = SimulatedCalle([ScriptedAnswer(cash_price_usd="19.99")])
    survey = await _run(sim, 1)
    assert len(survey.comparable) == 1
    assert survey.comparable[0].price_usd == 19.99


async def test_the_request_carries_the_schema_and_a_masked_free_number() -> None:
    seen: list[httpx.Request] = []
    sim = SimulatedCalle()
    inner = sim.transport()

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return inner.handler(request)

    transport = CalleTransport(
        api_key="simulated",
        base_url=SIMULATED_BASE_URL,
        transport=httpx.MockTransport(record),
        poll_interval=SIMULATED_POLL_SECONDS,
    )
    await run_survey(
        drug=DRUG,
        postal_code="00000",
        pharmacies=[_pharmacy(1)],
        transport=transport,
        caller_org="an independent price comparison",
        live=False,
        fetch_nadac=False,
    )
    create = next(r for r in seen if r.method == "POST")
    body = create.read().decode()
    assert "recipient_result_schema" in body
    assert "Idempotency-Key" in create.headers
    assert create.headers["Authorization"].startswith("Bearer ")


async def test_the_same_request_never_dials_twice() -> None:
    """A crash and a restart must reuse the key, and CALL-E must return the same call."""
    sim = SimulatedCalle()
    transport = _transport(sim)
    task = build_task(DRUG, caller_org="org")
    key = idempotency_key(run_id="r1", phone="+12025550101", task=task, schema=RECIPIENT_SCHEMA)

    first = await transport.create(
        phone="+12025550101",
        task=task,
        recipient_schema=RECIPIENT_SCHEMA,
        metadata={},
        idem_key=key,
    )
    second = await transport.create(
        phone="+12025550101",
        task=task,
        recipient_schema=RECIPIENT_SCHEMA,
        metadata={},
        idem_key=key,
    )
    assert first == second
    assert sim.placed == 1


def test_the_idempotency_key_is_bound_to_content_not_to_the_attempt() -> None:
    base = dict(run_id="r1", phone="+12025550101", task="ask", schema=RECIPIENT_SCHEMA)
    assert idempotency_key(**base) == idempotency_key(**base)
    assert idempotency_key(**{**base, "task": "ask something else"}) != idempotency_key(**base)
    assert idempotency_key(**{**base, "run_id": "r2"}) != idempotency_key(**base)
    assert len(idempotency_key(**base)) <= 255


async def test_a_timeout_halts_instead_of_retrying() -> None:
    """A rejected request is a fact. A timeout is not: the phone may be ringing."""

    def always_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("simulated", request=request)

    transport = CalleTransport(
        api_key="simulated",
        base_url=SIMULATED_BASE_URL,
        transport=httpx.MockTransport(always_timeout),
    )
    with pytest.raises(CalleAmbiguous):
        await transport.create(
            phone="+12025550101",
            task="ask",
            recipient_schema=RECIPIENT_SCHEMA,
            metadata={},
            idem_key="k",
        )


async def test_an_ambiguous_call_stops_the_whole_survey() -> None:
    def always_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("simulated", request=request)

    transport = CalleTransport(
        api_key="simulated",
        base_url=SIMULATED_BASE_URL,
        transport=httpx.MockTransport(always_timeout),
    )
    with pytest.raises(CalleAmbiguous):
        await run_survey(
            drug=DRUG,
            postal_code="00000",
            pharmacies=[_pharmacy(i) for i in range(3)],
            transport=transport,
            caller_org="org",
            live=False,
            fetch_nadac=False,
        )


async def test_a_refused_request_is_recorded_and_the_survey_continues() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": {"code": "unsupported_region"}})

    transport = CalleTransport(
        api_key="simulated",
        base_url=SIMULATED_BASE_URL,
        transport=httpx.MockTransport(refuse),
    )
    survey = await run_survey(
        drug=DRUG,
        postal_code="00000",
        pharmacies=[_pharmacy(1), _pharmacy(2)],
        transport=transport,
        caller_org="org",
        live=False,
        fetch_nadac=False,
    )
    assert len(survey.quotes) == 2
    assert not survey.comparable


async def test_missing_credentials_are_rejected_by_the_simulator() -> None:
    sim = SimulatedCalle()
    bare = httpx.AsyncClient(base_url=SIMULATED_BASE_URL, transport=sim.transport())
    response = await bare.post("/v1/calls", json={})
    await bare.aclose()
    assert response.status_code == 401


# -- what counts as an answer ----------------------------------------------------


async def test_voicemail_is_not_a_price() -> None:
    """A voicemail box comes back completed with task_completed true. It is still not a price."""
    sim = SimulatedCalle([ScriptedAnswer(answered_by="voicemail", quote_status="unknown")])
    survey = await _run(sim, 1)
    assert not survey.comparable
    assert len(survey.unreached) == 1


async def test_a_refusal_is_kept_in_the_denominator() -> None:
    sim = SimulatedCalle(
        [
            ScriptedAnswer(cash_price_usd="10.00"),
            ScriptedAnswer(quote_status="refused", cash_price_usd="unknown"),
        ]
    )
    survey = await _run(sim, 2)
    assert len(survey.comparable) == 1
    assert len(survey.refused) == 1
    assert survey.quote_rate == 50.0


async def test_a_different_bottle_size_is_reported_but_never_rescaled() -> None:
    """Rescaling 90 tablets to 30 assumes a linearity pharmacy pricing does not have."""
    sim = SimulatedCalle(
        [
            ScriptedAnswer(cash_price_usd="10.00", quantity_quoted="30"),
            ScriptedAnswer(cash_price_usd="24.00", quantity_quoted="90"),
        ]
    )
    survey = await _run(sim, 2)
    assert [q.price_usd for q in survey.comparable] == [10.00]
    assert [q.price_usd for q in survey.other_quantity] == [24.00]
    assert survey.spread_multiple is None


async def test_an_unparseable_price_is_dropped_rather_than_guessed() -> None:
    sim = SimulatedCalle([ScriptedAnswer(cash_price_usd="about twenty dollars")])
    survey = await _run(sim, 1)
    assert not survey.comparable


# -- the arithmetic --------------------------------------------------------------


def _survey_with(prices: list[float], nadac: NadacRow | None = None) -> Survey:
    now = _dt.datetime(2026, 9, 9, 12, 0, 0)
    quotes = [
        Quote(
            pharmacy=f"Pharmacy {i}",
            city="Springfield",
            phone_masked="+1******0142",
            quote_status="quoted",
            answered_by="human",
            price_usd=price,
            quantity=30,
        )
        for i, price in enumerate(prices)
    ]
    return Survey(
        drug=DRUG,
        postal_code="00000",
        quotes=quotes,
        nadac=nadac,
        started_at=now,
        finished_at=now + _dt.timedelta(seconds=185),
    )


def test_spread_is_the_ratio_of_dearest_to_cheapest() -> None:
    survey = _survey_with([10.0, 40.0, 100.0])
    assert survey.spread_multiple == 10.0
    assert survey.median_price == 40.0


def test_markup_is_measured_against_the_published_acquisition_cost() -> None:
    nadac = NadacRow(
        ndc_description="METFORMIN HCL 500 MG TABLET",
        ndc="00000000000",
        per_unit_usd=0.01415,
        pricing_unit="EA",
        effective_date="2026-08-19",
        otc=False,
        classification="G",
    )
    survey = _survey_with([42.45], nadac=nadac)
    assert survey.acquisition_cost == 0.42
    assert survey.markup(42.45) == 101.1


def test_the_annual_number_is_median_minus_cheapest_over_a_year() -> None:
    survey = _survey_with([10.0, 20.0, 30.0])
    assert survey.annual_difference_usd == pytest.approx(120.0)


def test_a_single_price_has_no_spread() -> None:
    assert _survey_with([25.0]).spread_multiple is None


def test_the_receipt_reports_time_and_how_many_calls_were_actually_placed() -> None:
    survey = _survey_with([10.0, 20.0])
    assert survey.elapsed_human == "3 min 5 sec"
    assert survey.calls_placed == 2


def test_a_pharmacy_the_run_stopped_before_is_not_counted_as_a_call() -> None:
    """A halted run leaves rows nobody dialled. Counting them would overstate the run."""
    survey = _survey_with([10.0])
    survey.quotes.append(
        Quote(
            pharmacy="Never Reached Pharmacy",
            city="Springfield",
            phone_masked="+1******0199",
            quote_status="unknown",
            answered_by="unknown",
            price_usd=None,
            quantity=None,
            notes="Not dialled. An earlier call ended without a definite outcome.",
            dialled=False,
        )
    )
    assert len(survey.quotes) == 2
    assert survey.calls_placed == 1
    assert "1 not dialled" in render_text(survey)


def test_a_simulated_report_never_claims_calls_were_placed() -> None:
    """The header says no calls were placed, so the footer must not contradict it."""
    simulated = _survey_with([10.0, 20.0])
    text = render_text(simulated)
    assert "SIMULATED, no calls placed" in text
    assert "calls placed" not in text.split("SIMULATED, no calls placed", 1)[1]
    assert "2 simulated calls, none placed" in text

    simulated.live = True
    assert "2 calls placed" in render_text(simulated)


def test_the_rendered_report_never_prints_a_full_number() -> None:
    survey = _survey_with([10.0, 20.0])
    assert "5550142" not in render_text(survey)


def test_the_report_says_plainly_when_no_calls_were_placed() -> None:
    assert "SIMULATED, no calls placed" in render_text(_survey_with([10.0]))


# -- the registry ----------------------------------------------------------------


def test_one_counter_holding_several_licences_is_called_once() -> None:
    """A storefront often holds a retail NPI and a specialty NPI. It is still one shop."""
    a = _pharmacy(1)
    b = Pharmacy(
        npi="0000009999",
        name="Example Pharmacy 1 Specialty",
        phone=a.phone,
        address=a.address,
        city=a.city,
        state=a.state,
        postal_code=a.postal_code,
    )
    assert _dedupe_key(a) == _dedupe_key(b)


def test_registry_numbers_become_e164() -> None:
    assert _pharmacy(1).e164 == "+12025550101"


# -- the command line ------------------------------------------------------------


def test_the_default_run_places_no_calls(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["survey", "--offline", "--count", "4"]) == 0
    assert "SIMULATED, no calls placed" in capsys.readouterr().out


def test_live_is_refused_without_the_environment_gate(monkeypatch, capsys) -> None:
    monkeypatch.delenv("STICKER_LIVE_CALLS_ENABLED", raising=False)
    monkeypatch.setenv("CALLE_API_KEY", "key")
    assert main(["survey", "--live", "--confirm", "PLACE-REAL-CALLS"]) == 2
    assert "STICKER_LIVE_CALLS_ENABLED" in capsys.readouterr().err


def test_live_is_refused_without_the_confirmation_token(monkeypatch, capsys) -> None:
    monkeypatch.setenv("STICKER_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "key")
    assert main(["survey", "--live"]) == 2
    assert "PLACE-REAL-CALLS" in capsys.readouterr().err


def test_an_api_key_alone_never_makes_a_run_live(monkeypatch, capsys) -> None:
    """Merely having credentials in the environment must not change what a plain run does."""
    monkeypatch.setenv("CALLE_API_KEY", "a-real-looking-key")
    monkeypatch.setenv("STICKER_LIVE_CALLS_ENABLED", "true")
    assert main(["survey", "--offline", "--count", "2"]) == 0
    assert "SIMULATED, no calls placed" in capsys.readouterr().out


def test_live_is_refused_when_no_destination_file_exists(monkeypatch, capsys, tmp_path) -> None:
    monkeypatch.setenv("STICKER_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "key")
    missing = tmp_path / "nope.txt"
    code = main(
        ["survey", "--live", "--confirm", "PLACE-REAL-CALLS", "--authorized", str(missing)]
    )
    assert code == 2
    assert "authorized destinations" in capsys.readouterr().err
