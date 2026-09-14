"""A later refusal does not retract an earlier request that went missing.

The create loop now stops immediately after a timeout, retaining the idempotency key
for manual reconciliation. A fixture that would refuse the next attempt proves that
the dispatcher never reaches that attempt or mistakes it for proof of non-placement.

Every non-call exit from the loop returned FAILED, and FAILED is a sentence with three
claims in it: nobody was reached, nothing will be billed, and the row can go on tomorrow's
list. Once a request has gone out and not come back, all three are unknown. The likeliest
real sequence is the one below: the first attempt times out while the platform is slow,
the second reaches it and is refused with `invalid_phone`. `invalid_phone` is permanent, so
the loop returned at once, and it is in `NEVER_CARRIED`, so the receipt told a reader the
platform refused the call and nothing was carried, about a call that may have been carried
and will appear on the vendor's bill.

`possibly_placed_key` is the whole remedy. It is the only handle anybody has for
reconciling the row against CALL-E's own record, and dropping it is what turned a row that
needed checking into a row that looked closed.
"""

from __future__ import annotations

import pytest

from calle import CalleAPIError, CalleTimeoutError
from dispatch import Resolution, RetryPolicy, WaveDispatcher, WorkItem
from dispatch.models import NEVER_CARRIED
from tests.fixtures import IN_A

SCHEMA = {"type": "object", "required": ["reason"],
          "properties": {"reason": {"type": "string"}}}


def _dispatcher(client, **kw):
    return WaveDispatcher(client, task_builder=lambda i: "x", result_schema=SCHEMA,
                          poll_interval_seconds=0, sleep=lambda _s: None,
                          retry=RetryPolicy(max_attempts=3), **kw)


def _run(create):
    class Client:
        class calls:
            pass
    Client.calls.create = staticmethod(create)
    report = _dispatcher(Client()).run(
        [WorkItem(id="S-77", phones=(IN_A,), consented=True)])
    return report.results[0]


@pytest.mark.parametrize("code", ["invalid_phone", "recipient_blocked",
                                  "insufficient_balance", "unknown_code_from_the_future"])
def test_a_refusal_after_an_unanswered_request_stays_undetermined(code):
    """One timeout, then an answer of any kind. The row is still unaccounted for.

    The codes cover the three branches that returned early: permanent, fatal, and a code
    in none of the sets. Each one used to produce FAILED.
    """
    sent = {"n": 0}

    def create(**kwargs):
        sent["n"] += 1
        if sent["n"] == 1:
            raise CalleTimeoutError("read timed out")
        raise CalleAPIError(code=code, message="refused", status_code=400)

    result = _run(create)

    assert sent["n"] == 1, "an unknown submission must not be automatically repeated"
    assert result.resolution is Resolution.UNDETERMINED, (
        f"a request that may already have placed a call was reported "
        f"{result.resolution.value} once a later attempt was refused with {code}")
    assert result.possibly_placed_key, (
        "the row carries no idempotency key, and without it there is nothing to "
        "reconcile the possible call against")
    assert "automatic submission stopped" in result.reason
    assert "read timed out" in result.reason


def test_the_refusal_code_does_not_travel_as_a_definite_failure_code():
    """`failure_code` is read without the resolution beside it, so it stays empty.

    `cli.py` collects `idempotency_conflict` on the code alone and prints "nothing was
    dialled again" about every row it finds. `NEVER_CARRIED` is gated on FAILED and so is
    safe either way, but a consumer that reads the code without the resolution would
    reintroduce exactly the definite sentence this change removed.
    """
    def create(**kwargs):
        if not hasattr(create, "seen"):
            create.seen = True
            raise CalleTimeoutError("read timed out")
        raise CalleAPIError(code="idempotency_conflict", message="key reused",
                            status_code=409)

    result = _run(create)
    assert result.failure_code is None, (
        f"the row carries failure_code {result.failure_code!r}, which every consumer "
        "keyed on the code alone will read as a settled outcome")
    assert not (result.resolution is Resolution.FAILED
                and result.failure_code in NEVER_CARRIED), (
        "the run would credit this row as never carried while the call may have been")


def test_a_refusal_with_nothing_unanswered_before_it_is_still_a_failure():
    """The other half of the rule. Nothing was sent into the dark, so FAILED is honest."""
    def create(**kwargs):
        raise CalleAPIError(code="invalid_phone", message="refused", status_code=400)

    result = _run(create)
    assert result.resolution is Resolution.FAILED, (
        "a row refused on its first and only attempt was not placed, and calling that "
        "undetermined would put a row that needs nothing on the reconciliation list")
    assert result.failure_code == "invalid_phone"
    assert not result.possibly_placed_key
