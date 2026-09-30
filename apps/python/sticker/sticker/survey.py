"""Run the survey: many pharmacies, one question, one table at the end.

Concurrency is deliberately conservative, and the ceiling here is ours rather than the
platform's. Calls issued together can overlap, but where an account's own limit sits is
neither documented nor exposed on the API, so the semaphore stays low. A survey is a batch
of calls to working businesses, and the cost of guessing high is a lot of phones ringing at
once in one neighbourhood.
"""

from __future__ import annotations

import asyncio
import datetime as _dt

from .call_design import RECIPIENT_SCHEMA, DrugRequest, build_task
from .calle import (
    CalleAmbiguous,
    CalleBusy,
    CalleError,
    CalleTransport,
    derive_run_id,
    idempotency_key,
)
from .nadac import NadacError, NadacRow, lookup
from .pharmacies import Pharmacy
from .report import Quote, Survey
from .safety import mask

DEFAULT_CONCURRENCY = 3

# How many times to wait out the account's concurrent-call limit before giving up on a
# pharmacy. A 429 means nothing was dialled, so waiting costs time and never a call.
BUSY_RETRIES = 4
BUSY_BACKOFF_SECONDS = 8.0


def _to_float(value: object) -> float | None:
    """Parse a price the agent reported. Anything unclear becomes None, never a guess."""
    if value is None:
        return None
    text = str(value).strip().lstrip("$").replace(",", "")
    if not text or text.lower() in {"unknown", "none", "n/a", "na"}:
        return None
    try:
        price = float(text)
    except ValueError:
        return None
    return price if price > 0 else None


def _to_int(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text.lower() in {"unknown", "none", "n/a", "na"}:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _quote_from(pharmacy: Pharmacy, structured: dict, call_id: str) -> Quote:
    return Quote(
        pharmacy=pharmacy.name,
        city=pharmacy.city,
        phone_masked=mask(pharmacy.e164),
        quote_status=str(structured.get("quote_status") or "unknown"),
        answered_by=str(structured.get("answered_by") or "unknown"),
        price_usd=_to_float(structured.get("cash_price_usd")),
        quantity=_to_int(structured.get("quantity_quoted")),
        requires_prescription_on_file=str(
            structured.get("requires_prescription_on_file") or "unknown"
        ),
        discount_program_mentioned=str(structured.get("discount_program_mentioned") or "unknown"),
        notes=str(structured.get("notes") or ""),
        call_id=call_id,
    )


def _unreached(pharmacy: Pharmacy, why: str, *, dialled: bool = True) -> Quote:
    return Quote(
        pharmacy=pharmacy.name,
        city=pharmacy.city,
        phone_masked=mask(pharmacy.e164),
        quote_status="unknown",
        answered_by="unknown",
        price_usd=None,
        quantity=None,
        notes=why,
        dialled=dialled,
    )


class RunHalted(RuntimeError):
    """The run stopped before this call because an earlier one ended uncertainly."""


async def _one_call(
    transport: CalleTransport,
    pharmacy: Pharmacy,
    *,
    task: str,
    run_id: str,
    gate: asyncio.Semaphore,
    halt: asyncio.Event,
) -> Quote:
    async with gate:
        # The last gate before a phone rings. If any earlier call ended in a state where
        # we cannot tell whether it was placed, no further number gets dialled: the
        # operator has to reconcile first. Checking here rather than up front is what
        # makes it work, because the queue behind a semaphore is where the calls that
        # have not happened yet are waiting.
        if halt.is_set():
            raise RunHalted(
                "Not dialled. An earlier call in this run ended without a definite "
                "outcome, so the run stopped before placing any further calls."
            )
        key = idempotency_key(
            run_id=run_id, phone=pharmacy.e164, task=task, schema=RECIPIENT_SCHEMA
        )
        try:
            # The account's concurrency cap is not documented and not exposed, so the only
            # way to find it is to reach it. A 429 means this call was definitely not
            # placed, which makes it the one error here that is safe to wait out. Backing
            # off keeps the pharmacy in the survey instead of dropping it for a reason
            # that has nothing to do with the pharmacy.
            for attempt in range(BUSY_RETRIES + 1):
                try:
                    call_id = await transport.create(
                        phone=pharmacy.e164,
                        task=task,
                        recipient_schema=RECIPIENT_SCHEMA,
                        metadata={"sticker_run_id": run_id, "sticker_npi": pharmacy.npi},
                        idem_key=key,
                    )
                    break
                except CalleBusy:
                    if attempt == BUSY_RETRIES:
                        raise
                    await asyncio.sleep(BUSY_BACKOFF_SECONDS * (attempt + 1))
            outcome = await transport.wait(call_id)
        except CalleAmbiguous:
            halt.set()
            raise

    # A completed call is not an answered question: a voicemail box comes back completed
    # with task_completed true. The structured answer decides, not the status.
    if not outcome.structured:
        return _unreached(pharmacy, f"Call ended {outcome.status} with no structured answer.")
    return _quote_from(pharmacy, outcome.structured, outcome.call_id)


async def run_survey(
    *,
    drug: DrugRequest,
    postal_code: str,
    pharmacies: list[Pharmacy],
    transport: CalleTransport,
    caller_org: str,
    live: bool,
    concurrency: int = DEFAULT_CONCURRENCY,
    fetch_nadac: bool = True,
    run_id: str | None = None,
) -> Survey:
    """Call every pharmacy in `pharmacies` once, then price the answers against CMS.

    Callers are responsible for having authorized these destinations already. This
    function dials whatever it is handed.
    """
    run_id = run_id or derive_run_id(
        drug=drug.spoken(),
        postal_code=postal_code,
        phones=[p.e164 for p in pharmacies],
        caller_org=caller_org,
        day=_dt.date.today().isoformat(),
    )
    task = build_task(drug, caller_org=caller_org)
    gate = asyncio.Semaphore(max(1, concurrency))
    halt = asyncio.Event()
    started = _dt.datetime.now()

    results = await asyncio.gather(
        *(
            _one_call(transport, pharmacy, task=task, run_id=run_id, gate=gate, halt=halt)
            for pharmacy in pharmacies
        ),
        return_exceptions=True,
    )

    quotes: list[Quote] = []
    ambiguous: CalleAmbiguous | None = None
    for pharmacy, result in zip(pharmacies, results):
        if isinstance(result, CalleAmbiguous):
            # Never swallowed and never retried. Keep the first one and report it after
            # every other row has been accounted for, so the operator can see exactly
            # which pharmacies were called and which were stopped.
            ambiguous = ambiguous or result
            quotes.append(_unreached(pharmacy, f"Uncertain outcome: {result}"))
        elif isinstance(result, RunHalted):
            quotes.append(_unreached(pharmacy, str(result), dialled=False))
        elif isinstance(result, CalleBusy):
            quotes.append(
                _unreached(
                    pharmacy,
                    "Not dialled. The account's concurrent-call limit stayed full.",
                    dialled=False,
                )
            )
        elif isinstance(result, CalleError):
            quotes.append(_unreached(pharmacy, f"CALL-E refused this call: {result}"))
        elif isinstance(result, BaseException):
            quotes.append(_unreached(pharmacy, f"{type(result).__name__} during the call."))
        else:
            quotes.append(result)

    if ambiguous is not None:
        raise ambiguous

    finished = _dt.datetime.now()

    nadac: NadacRow | None = None
    if fetch_nadac:
        try:
            nadac = lookup(drug.nadac_prefix())
        except (NadacError, Exception):
            # A missing acquisition cost weakens the report; it must not lose the prices.
            nadac = None

    return Survey(
        drug=drug,
        postal_code=postal_code,
        quotes=quotes,
        nadac=nadac,
        started_at=started,
        finished_at=finished,
        live=live,
    )
