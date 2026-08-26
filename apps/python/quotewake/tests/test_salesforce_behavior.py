from datetime import datetime, timezone
from decimal import Decimal
from dataclasses import replace

import httpx
import pytest

from quotewake_salesforce.config import RegionalSettings
from quotewake_salesforce.domain.models import CallOutcomeKind, CallResult, ContactTarget, FollowUpUpdate, QuoteCandidate
from quotewake_salesforce.salesforce.client import SalesforceClient, SalesforceError, SalesforceQueryError, SalesforceResponseError, SalesforceSchemaError
from quotewake_salesforce.salesforce.codecs import non_negative_integer, salesforce_id
from quotewake_salesforce.salesforce.quotes import QuoteRepository, REQUIRED_QUOTE_FIELDS


def test_codecs_reject_invalid_id_and_negative_count():
    with pytest.raises(SalesforceResponseError):
        salesforce_id("bad", "Quote.Id", prefix="0Q")
    with pytest.raises(SalesforceResponseError):
        non_negative_integer(-1, "Attempt_Count__c")


def test_oauth_error_is_normalized_without_response_secret():
    def handler(request):
        return httpx.Response(401, json={"error": "invalid_client", "error_description": "secret must not leak"})
    client = SalesforceClient("https://login.invalid", "id", "secret", "61.0", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(Exception, match="authentication failed"):
        client.query("SELECT Id FROM Account")


def test_rest_query_preserves_decimal_amounts_exactly():
    def handler(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(
                200,
                json={
                    "access_token": "token",
                    "instance_url": "https://instance.invalid",
                },
            )
        return httpx.Response(
            200,
            text='{"records":[{"GrandTotal":10.25}],"done":true}',
            headers={"content-type": "application/json"},
        )

    client = SalesforceClient(
        "https://login.invalid",
        "id",
        "secret",
        "61.0",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    records = client.query("SELECT GrandTotal FROM Quote")

    assert records[0]["GrandTotal"] == Decimal("10.25")
    assert isinstance(records[0]["GrandTotal"], Decimal)


def test_repository_requires_exact_four_custom_quote_fields():
    assert {"QuoteWake_Enabled__c", "Follow_Up_Status__c", "Next_Follow_Up_At__c", "Attempt_Count__c"}.issubset(REQUIRED_QUOTE_FIELDS)
    assert len({name for name in REQUIRED_QUOTE_FIELDS if name.endswith("__c")}) == 4


def test_repository_maps_quote_record_without_removed_fields():
    repository = QuoteRepository(MockClient())
    record = {
        "Id": "0Q0000000000001", "Name": "Demo", "OpportunityId": "006000000000001",
        "Status": "Presented", "ExpirationDate": "2026-12-01", "LastModifiedDate": "2026-08-01T00:00:00.000Z",
        "QuoteWake_Enabled__c": True, "Follow_Up_Status__c": None, "Next_Follow_Up_At__c": None, "Attempt_Count__c": 0,
        "Opportunity": {"Name": "Opportunity", "IsClosed": False, "Account": {"Name": "Account", "BillingCountryCode": "ES"}},
    }
    mapped = repository._quote_from_record(record, None, None, "EUR", {})
    assert mapped.attempt_count == 0
    assert not hasattr(mapped, "last_follow_up_at")
    assert mapped.account_billing_country_code == "ES"


def test_repository_reads_organization_regional_settings_from_salesforce():
    class OrganizationClient:
        def query(self, soql):
            assert soql == "SELECT TimeZoneSidKey, DefaultLocaleSidKey FROM Organization LIMIT 1"
            return [{"TimeZoneSidKey": "Europe/Madrid", "DefaultLocaleSidKey": "es_ES"}]

    settings = QuoteRepository(OrganizationClient()).load_organization_regional_settings()
    assert isinstance(settings, RegionalSettings)
    assert settings.business_timezone.key == "Europe/Madrid"
    assert settings.locale == "es_ES"


class MockClient:
    pass


def verified(result, quote, contact):
    digest = "a" * 64
    return replace(
        result,
        binding_digest=digest,
        provider_key="quotewake-bound-call",
        bound_phone=contact.phone,
        bound_task="Conduct a verified call.",
        bound_schema_digest="b" * 64,
        bound_metadata=(
            ("quotewake_binding_digest", digest),
            ("quotewake_contact_id", contact.contact_id),
            ("quotewake_opportunity_id", quote.opportunity_id),
            ("quotewake_quote_id", quote.quote_id),
        ),
        binding_verified=True,
    )


def test_salesforce_write_rejects_unverified_result_before_network_call():
    client = SalesforceClient("https://login.invalid", "id", "secret", "61.0")
    quote = QuoteCandidate("0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None, datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0)
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    result = CallResult(quote.quote_id, "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc))
    with pytest.raises(SalesforceError, match="verified CALL-E binding"):
        client.composite_write(quote, contact, FollowUpUpdate(1, "Completed", None), result, task_description="summary")


def test_salesforce_write_rejects_verified_result_for_different_phone():
    client = SalesforceClient("https://login.invalid", "id", "secret", "61.0")
    quote = QuoteCandidate("0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None, datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0)
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    result = verified(CallResult(quote.quote_id, "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc)), quote, contact)
    other_contact = ContactTarget(contact.contact_id, contact.name, "+14155550102", False)
    with pytest.raises(SalesforceError, match="Contact phone"):
        client.composite_write(quote, other_contact, FollowUpUpdate(1, "Completed", None), result, task_description="summary")


def test_single_currency_org_requires_explicit_iso_code():
    repository = QuoteRepository(MockClient())

    with pytest.raises(SalesforceSchemaError, match="SALESFORCE_CURRENCY_CODE"):
        repository._corporate_currency()

    assert QuoteRepository(
        MockClient(), default_currency_code="EUR"
    )._corporate_currency() == "EUR"


def test_composite_payload_is_all_or_none_and_links_task():
    seen = []
    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        return httpx.Response(200, json={"compositeResponse": [{"httpStatusCode": 204, "referenceId": "quoteUpdate", "body": None}, {"httpStatusCode": 201, "referenceId": "taskCreate", "body": {"id": "00T000000000001"}}]})
    client = SalesforceClient("https://login.invalid", "id", "secret", "61.0", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    quote = QuoteCandidate("0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None, datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0)
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    update = FollowUpUpdate(1, "Completed", None)
    result = verified(CallResult(quote.quote_id, "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc)), quote, contact)
    written = client.composite_write(quote, contact, update, result, task_description="summary")
    assert written.task_id == "00T000000000001"
    payload = seen[-1].content.decode()
    assert '"allOrNone":true' in payload
    assert '"WhatId":"0Q0000000000001"' in payload


def test_composite_failure_is_not_silently_accepted():
    def handler(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        return httpx.Response(200, json={"compositeResponse": [{"httpStatusCode": 400, "referenceId": "quoteUpdate", "body": {}}]})
    client = SalesforceClient("https://login.invalid", "id", "secret", "61.0", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    quote = QuoteCandidate("0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None, datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0)
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    result = verified(CallResult(quote.quote_id, "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc)), quote, contact)
    with pytest.raises(SalesforceQueryError):
        client.composite_write(
            quote, contact, FollowUpUpdate(1, "Completed", None), result, task_description="summary",
        )


def test_stop_quote_follow_up_is_atomic_quote_and_review_task_without_contact_patch():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        return httpx.Response(200, json={"compositeResponse": [
            {"httpStatusCode": 204, "referenceId": "quoteUpdate", "body": None},
            {"httpStatusCode": 201, "referenceId": "taskCreate", "body": {"id": "00T000000000001"}},
        ]})

    client = SalesforceClient(
        "https://login.invalid", "id", "secret", "61.0",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    quote = QuoteCandidate(
        "0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None,
        datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0,
    )
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    result = verified(CallResult(
        quote.quote_id, "call-1", "completed", "stop_quote_follow_up", "unknown", None,
        "Do not call again", "Stop Quote follow-up", None, CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    ), quote, contact)
    client.composite_write(
        quote, contact, FollowUpUpdate(1, "Stopped", None), result,
        task_description="Review the request to stop Quote follow-up.",
    )
    import json
    payload = json.loads(seen[-1].content)
    requests = payload["compositeRequest"]
    assert payload["allOrNone"] is True
    assert [(item["method"], item["url"]) for item in requests] == [
        ("PATCH", "/services/data/v61.0/sobjects/Quote/0Q0000000000001"),
        ("POST", "/services/data/v61.0/sobjects/Task"),
    ]
    assert all("Contact" not in item["url"] for item in requests)
    assert requests[1]["body"]["WhoId"] == contact.contact_id
    assert requests[1]["body"]["Subject"] == "QuoteWake call outcome: stop_quote_follow_up"


def test_unknown_result_creates_human_review_task_in_same_composite():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        return httpx.Response(200, json={"compositeResponse": [
            {"httpStatusCode": 204, "referenceId": "quoteUpdate", "body": None},
            {"httpStatusCode": 201, "referenceId": "taskCreate", "body": {"id": "00T000000000001"}},
        ]})

    client = SalesforceClient(
        "https://login.invalid", "id", "secret", "61.0",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    quote = QuoteCandidate(
        "0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None,
        datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0,
    )
    contact = ContactTarget("003000000000001", "Contact", "+14155550101", False)
    result = verified(CallResult(
        quote.quote_id, "call-1", "completed", "unknown", "unknown", None,
        "Insufficient evidence", "Human review", None, CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    ), quote, contact)
    client.composite_write(
        quote, contact, FollowUpUpdate(1, "Stopped", None), result,
        task_description="Review the call evidence.",
    )
    import json
    payload = json.loads(seen[-1].content)
    assert payload["compositeRequest"][1]["body"]["Subject"] == "QuoteWake call outcome: unknown (human review)"


def test_call_not_established_task_does_not_request_human_review():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "token", "instance_url": "https://instance.invalid"})
        return httpx.Response(200, json={"compositeResponse": [
            {"httpStatusCode": 204, "referenceId": "quoteUpdate", "body": None},
            {"httpStatusCode": 201, "referenceId": "taskCreate", "body": {"id": "00T000000000001"}},
        ]})

    client = SalesforceClient(
        "https://login.invalid", "id", "secret", "61.0",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    quote = QuoteCandidate(
        "0Q0000000000001", "Demo", "Presented", Decimal("10"), "EUR", None,
        datetime.now(timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0,
    )
    result = verified(CallResult(
        quote.quote_id, "call-1", "declined", "call_not_established", "unknown", None,
        "CALL-E reported that the call was not established.",
        "Retry the quote follow-up after the configured delay.",
        None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc),
    ), quote, ContactTarget("003000000000001", "Contact", "+14155550101", False))
    client.composite_write(
        quote,
        ContactTarget("003000000000001", "Contact", "+14155550101", False),
        FollowUpUpdate(1, "Retry", datetime.now(timezone.utc)),
        result,
        task_description="The call was not established; retry later.",
    )

    import json
    payload = json.loads(seen[-1].content)
    subject = payload["compositeRequest"][1]["body"]["Subject"]
    assert subject == "QuoteWake call outcome: call_not_established"
    assert "human review" not in subject.lower()
