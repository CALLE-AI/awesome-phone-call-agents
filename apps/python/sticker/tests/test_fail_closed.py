"""What happens when we cannot tell whether a phone rang.

Every test here is about the same question. A refusal is a fact and the survey can carry
on. Anything else, a server error, a lost read, a status nobody recognises, means a call
may be in progress at a real pharmacy, and the only safe move is to stop dialling.

The other half of the file covers the controls that decide who gets dialled at all: the
allowlist reader, the call ceiling, and the masking that keeps real numbers off every
surface except the one file the operator edits.
"""

from __future__ import annotations

import json

import httpx
import pytest

from sticker.call_design import RECIPIENT_SCHEMA, DrugRequest
from sticker.calle import (
    CalleAmbiguous,
    CalleBusy,
    CalleError,
    CalleTransport,
    derive_run_id,
)
from sticker.cli import _read_authorized, build_parser, cmd_survey
from sticker.pharmacies import Pharmacy
from sticker.safety import mask, mask_deep
from sticker.survey import run_survey

FICTIONAL = "+12025550142"


def _pharmacy(index: int) -> Pharmacy:
    return Pharmacy(
        npi=f"000000{index:04d}",
        name=f"Example Pharmacy {index}",
        phone=f"202-555-{100 + index:04d}",
        address="1 Example Street",
        city="Springfield",
        state="EX",
        postal_code="00000",
    )


def _transport(handler) -> CalleTransport:
    return CalleTransport(
        api_key="test-key",
        base_url="https://sticker.invalid",
        transport=httpx.MockTransport(handler),
    )


# -- the transport fails closed -------------------------------------------------


async def test_a_server_error_on_create_is_ambiguous_not_refused() -> None:
    """A 5xx reached CALL-E and broke inside it, so the call may already be ringing."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "upstream unavailable"})

    async with _transport(handler) as transport:
        with pytest.raises(CalleAmbiguous):
            await transport.create(
                phone=FICTIONAL,
                task="ask the price",
                recipient_schema=RECIPIENT_SCHEMA,
                metadata={},
                idem_key="k",
            )


async def test_a_client_error_on_create_is_a_refusal() -> None:
    """A 4xx is the provider saying no. That is a fact, and the survey can continue."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": "bad region"})

    async with _transport(handler) as transport:
        with pytest.raises(CalleError):
            await transport.create(
                phone=FICTIONAL,
                task="ask the price",
                recipient_schema=RECIPIENT_SCHEMA,
                metadata={},
                idem_key="k",
            )


async def test_the_concurrency_limit_is_backpressure_not_a_refusal() -> None:
    """HTTP 429 means the account's line was full and nothing was dialled.

    That is the one definite negative in this transport, so it gets its own type: a
    refusal would drop the pharmacy and an ambiguity would halt the run, and neither is
    true of a call that provably did not happen.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"code": "account_concurrency_exceeded"}})

    async with _transport(handler) as transport:
        with pytest.raises(CalleBusy):
            await transport.create(
                phone=FICTIONAL,
                task="ask the price",
                recipient_schema=RECIPIENT_SCHEMA,
                metadata={},
                idem_key="k",
            )


async def test_a_busy_line_is_waited_out_and_the_pharmacy_still_gets_called(monkeypatch) -> None:
    """Backing off keeps the pharmacy in the survey rather than dropping it."""
    monkeypatch.setattr("sticker.survey.BUSY_BACKOFF_SECONDS", 0.0)
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            attempts["n"] += 1
            if attempts["n"] < 3:
                return httpx.Response(429, json={"error": {"code": "account_concurrency_exceeded"}})
            return httpx.Response(200, json={"id": "call_1"})
        return httpx.Response(
            200,
            json={
                "id": "call_1",
                "status": "completed",
                "recipients": [{"structured_result": {"quote_status": "quoted",
                                                      "cash_price_usd": "12.50",
                                                      "quantity_quoted": "30",
                                                      "answered_by": "human"}}],
            },
        )

    async with _transport(handler) as transport:
        survey = await run_survey(
            drug=DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30),
            postal_code="00000",
            pharmacies=[_pharmacy(1)],
            transport=transport,
            caller_org="a test",
            live=True,
            concurrency=1,
            fetch_nadac=False,
        )

    assert attempts["n"] == 3
    assert len(survey.comparable) == 1
    assert survey.comparable[0].price_usd == 12.50


async def test_a_line_that_stays_full_is_not_counted_as_a_call_placed(monkeypatch) -> None:
    monkeypatch.setattr("sticker.survey.BUSY_BACKOFF_SECONDS", 0.0)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"code": "account_concurrency_exceeded"}})

    async with _transport(handler) as transport:
        survey = await run_survey(
            drug=DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30),
            postal_code="00000",
            pharmacies=[_pharmacy(1)],
            transport=transport,
            caller_org="a test",
            live=True,
            concurrency=1,
            fetch_nadac=False,
        )

    assert survey.calls_placed == 0
    assert "concurrent-call limit" in survey.quotes[0].notes


async def test_a_2xx_that_is_not_an_object_is_ambiguous() -> None:
    """Accepted, but we cannot tell whether a call id was issued."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=["not", "an", "object"])

    async with _transport(handler) as transport:
        with pytest.raises(CalleAmbiguous):
            await transport.create(
                phone=FICTIONAL,
                task="ask the price",
                recipient_schema=RECIPIENT_SCHEMA,
                metadata={},
                idem_key="k",
            )


async def test_a_2xx_with_an_unreadable_body_is_ambiguous() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>gateway</html>")

    async with _transport(handler) as transport:
        with pytest.raises(CalleAmbiguous):
            await transport.create(
                phone=FICTIONAL,
                task="ask the price",
                recipient_schema=RECIPIENT_SCHEMA,
                metadata={},
                idem_key="k",
            )


async def test_losing_the_read_of_an_in_flight_call_is_ambiguous() -> None:
    """The call was created. Losing sight of it does not mean it did not happen."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/calls" and request.method == "POST":
            return httpx.Response(200, json={"id": "call_1"})
        return httpx.Response(404, json={"error": "not_found"})

    async with _transport(handler) as transport:
        call_id = await transport.create(
            phone=FICTIONAL,
            task="ask the price",
            recipient_schema=RECIPIENT_SCHEMA,
            metadata={},
            idem_key="k",
        )
        with pytest.raises(CalleAmbiguous):
            await transport.wait(call_id, interval=0.0, timeout=0.0)


async def test_an_unrecognised_status_is_ambiguous() -> None:
    """We cannot tell whether something called 'escalating' is still on a line."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"id": "call_1"})
        return httpx.Response(200, json={"id": "call_1", "status": "escalating"})

    async with _transport(handler) as transport:
        call_id = await transport.create(
            phone=FICTIONAL,
            task="ask the price",
            recipient_schema=RECIPIENT_SCHEMA,
            metadata={},
            idem_key="k",
        )
        with pytest.raises(CalleAmbiguous):
            await transport.wait(call_id, interval=0.0, timeout=0.0)


# -- the run stops before the next number ---------------------------------------


async def test_an_ambiguous_call_stops_the_run_before_any_later_create() -> None:
    """The queued pharmacies must not be dialled once an outcome is uncertain.

    Concurrency is one, so the first call resolves before the second is even attempted.
    That is the moment the halt has to bite: the second pharmacy's number must never
    reach the provider.
    """
    dialled: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = json.loads(request.content)
            dialled.append(body["recipients"][0]["phones"][0])
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"id": "x", "status": "completed"})

    pharmacies = [_pharmacy(i) for i in range(5)]
    async with _transport(handler) as transport:
        with pytest.raises(CalleAmbiguous):
            await run_survey(
                drug=DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30),
                postal_code="00000",
                pharmacies=pharmacies,
                transport=transport,
                caller_org="a test",
                live=True,
                concurrency=1,
                fetch_nadac=False,
            )

    assert len(dialled) == 1, f"halt failed: {len(dialled)} numbers reached the provider"


async def test_a_refusal_does_not_stop_the_run() -> None:
    """A 4xx is a fact about one pharmacy, so the rest of the survey still runs."""
    dialled: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = json.loads(request.content)
            dialled.append(body["recipients"][0]["phones"][0])
            return httpx.Response(422, json={"error": "refused"})
        return httpx.Response(200, json={"id": "x", "status": "completed"})

    pharmacies = [_pharmacy(i) for i in range(4)]
    async with _transport(handler) as transport:
        survey = await run_survey(
            drug=DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30),
            postal_code="00000",
            pharmacies=pharmacies,
            transport=transport,
            caller_org="a test",
            live=True,
            concurrency=1,
            fetch_nadac=False,
        )

    assert len(dialled) == 4
    assert len(survey.quotes) == 4


# -- restart deduplication is real ----------------------------------------------


def test_the_run_id_is_derived_from_the_run_not_the_process() -> None:
    """A restart must produce the same key, or the idempotency header is decoration."""
    args = dict(
        drug="metformin hcl 500 mg tablet",
        postal_code="10025",
        phones=[FICTIONAL, "+12025550143"],
        caller_org="a test",
        day="2026-09-09",
    )
    assert derive_run_id(**args) == derive_run_id(**args)


def test_the_run_id_ignores_the_order_the_allowlist_happened_to_be_in() -> None:
    day = "2026-09-09"
    a = derive_run_id(
        drug="d", postal_code="1", phones=["+12025550142", "+12025550143"], caller_org="o", day=day
    )
    b = derive_run_id(
        drug="d", postal_code="1", phones=["+12025550143", "+12025550142"], caller_org="o", day=day
    )
    assert a == b


def test_a_different_day_is_a_different_run() -> None:
    """Re-surveying tomorrow is genuinely new calls, not a cached yesterday."""
    base = dict(drug="d", postal_code="1", phones=[FICTIONAL], caller_org="o")
    assert derive_run_id(**base, day="2026-09-09") != derive_run_id(**base, day="2026-09-10")


# -- who may be dialled ---------------------------------------------------------


def test_the_allowlist_reader_accepts_the_file_find_writes(tmp_path) -> None:
    """`sticker find --out` annotates each number, so the reader must strip comments."""
    path = tmp_path / "authorized.txt"
    path.write_text(
        "# Candidates from NPPES. Delete every line you do not want dialled.\n"
        f"{FICTIONAL}  # Example Pharmacy\n"
        "+12025550143   # Another Pharmacy\n",
        encoding="utf-8",
    )
    assert _read_authorized(path) == frozenset({FICTIONAL, "+12025550143"})


def test_a_call_ceiling_of_zero_authorizes_zero_calls(tmp_path, monkeypatch, capsys) -> None:
    """Zero is the most cautious thing an operator can type. It must not mean 'no limit'."""
    path = tmp_path / "authorized.txt"
    path.write_text(f"{FICTIONAL}\n", encoding="utf-8")
    monkeypatch.setenv("STICKER_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    monkeypatch.setattr(
        "sticker.cli._load_pharmacies_for", lambda allowlist, postal_code: [_pharmacy(0)]
    )
    monkeypatch.setattr("sticker.cli.authorize_destinations", lambda requested, allowlist: requested)

    args = build_parser().parse_args(
        [
            "survey",
            "--live",
            "--confirm",
            "PLACE-REAL-CALLS",
            "--authorized",
            str(path),
            "--max-calls",
            "0",
        ]
    )
    assert cmd_survey(args) == 2
    assert "exceeds --max-calls 0" in capsys.readouterr().err


def test_a_negative_call_ceiling_is_refused(tmp_path, monkeypatch, capsys) -> None:
    path = tmp_path / "authorized.txt"
    path.write_text(f"{FICTIONAL}\n", encoding="utf-8")
    monkeypatch.setenv("STICKER_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    monkeypatch.setattr(
        "sticker.cli._load_pharmacies_for", lambda allowlist, postal_code: [_pharmacy(0)]
    )
    monkeypatch.setattr("sticker.cli.authorize_destinations", lambda requested, allowlist: requested)

    args = build_parser().parse_args(
        [
            "survey",
            "--live",
            "--confirm",
            "PLACE-REAL-CALLS",
            "--authorized",
            str(path),
            "--max-calls",
            "-1",
        ]
    )
    assert cmd_survey(args) == 2
    assert "cannot be negative" in capsys.readouterr().err


# -- masking covers how numbers actually appear ---------------------------------


@pytest.mark.parametrize(
    "written",
    [
        "+1 (202) 555-0142",
        "(202) 555-0142",
        "202-555-0142",
        "202.555.0142",
        "2025550142",
        "1-202-555-0142",
    ],
)
def test_every_common_phone_form_is_masked(written: str) -> None:
    """A pharmacist reads a number back in whatever shape they like, and it lands in the
    transcript that way. Matching only the E.164 form leaves the rest in the clear.
    """
    masked = mask_deep(f"you can reach us on {written} any time")
    flattened = masked.replace(" ", "").replace("-", "").replace(".", "").replace("(", "")
    assert "2025550142" not in flattened
    assert "5550142" not in flattened
    assert "0142" in masked


def test_masking_does_not_eat_ten_digit_identifiers_that_are_not_phones() -> None:
    """An NPI is ten digits too. Area codes never start 0 or 1, which is what saves us."""
    assert mask_deep("NPI 1063495123 is the provider") == "NPI 1063495123 is the provider"


def test_masking_a_local_number_does_not_invent_a_country_code() -> None:
    assert not mask("202-555-0142").startswith("+")
    assert mask("202-555-0142").endswith("0142")


def test_masking_reaches_into_nested_provider_payloads() -> None:
    payload = {
        "recipients": [{"attempts": [{"transcript_turns": [{"text": "call (202) 555-0142"}]}]}]
    }
    assert "555-0142" not in json.dumps(mask_deep(payload))
