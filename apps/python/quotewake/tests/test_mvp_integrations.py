from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import Mock, patch

import httpx

from quotewake_salesforce.calle.client import CallEClient, idempotency_key, operation_binding_digest
from quotewake_salesforce.domain.models import CallOutcomeKind, CallRequest, CallResult, ContactTarget, QuoteCandidate
from quotewake_salesforce.domain.policy import FollowUpPolicies, RetryPolicy, calculate_next_follow_up
from quotewake_salesforce.salesforce.client import SalesforceClient


def _quote() -> QuoteCandidate:
    return QuoteCandidate(
        "0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None,
        datetime(2026, 8, 1, tzinfo=timezone.utc), "006000000000001", "Opportunity",
        "Account", False, True, None, None, 0,
    )


def test_call_dry_run_does_not_construct_provider_client():
    request = CallRequest("0Q0000000000001", "006000000000001", "003000000000001", "+14155550101", "Conduct a call in es-ES.", "es-ES", "ES")
    with patch("calle.CalleClient", side_effect=AssertionError("SDK must not be constructed")):
        client = CallEClient(execute=False)
        result = client.preview(request, next_attempt=1)
    digest = operation_binding_digest(request, next_attempt=1)
    assert result["idempotency_key"] == idempotency_key(request.quote_id, 1, binding_digest=digest)
    assert result["binding_digest"] == digest


def test_technical_result_does_not_consume_business_attempt():
    # Policy-only sentinel: not a provider call ID and never persisted.
    result = CallResult("0Q0000000000001", "pre-acceptance-error-fixture", "technical_failure", "create_failed", "unknown", None, "CALL-E did not accept the call", "retry creation safely", None, CallOutcomeKind.TECHNICAL_FAILURE, datetime(2026, 8, 2, tzinfo=timezone.utc))
    policy = FollowUpPolicies(RetryPolicy(3, (timedelta(days=1), timedelta(days=2)), frozenset({"no_answer", "call_back_later", "call_not_established", "busy"}), timedelta(minutes=30), frozenset({"interested"})))
    update = calculate_next_follow_up(_quote(), result, policy)
    assert update.attempt_count == 0
    assert update.follow_up_status == "Retry"


def test_salesforce_client_authenticates_and_follows_query_pages():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        if request.url.path.endswith("/query"):
            return httpx.Response(200, json={"records": [{"Id": "001"}], "nextRecordsUrl": "/services/data/v61.0/query/next"})
        if request.url.path.endswith("/query/next"):
            return httpx.Response(200, json={"records": [{"Id": "002"}], "done": True})
        return httpx.Response(404)

    client = SalesforceClient("https://login.invalid", "client", "secret", "61.0", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.query("SELECT Id FROM Account") == [{"Id": "001"}, {"Id": "002"}]
