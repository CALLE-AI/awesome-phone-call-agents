"""Small Salesforce REST/OAuth boundary used by QuoteWake."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import re
from typing import Any

import httpx

from quotewake_salesforce.domain.models import ContactTarget, FollowUpUpdate, QuoteCandidate
from quotewake_salesforce.structured_logging import log_event


class SalesforceError(RuntimeError):
    """Base error for Salesforce connectivity and response failures."""


class SalesforceSchemaError(SalesforceError):
    pass


class SalesforceQueryError(SalesforceError):
    pass


class SalesforceResponseError(SalesforceError):
    pass


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON number {value}")


_SENSITIVE_TEXT = re.compile(
    r"(?i)(access[_ -]?token|client[_ -]?secret|authorization)\s*[:=]\s*\S+"
)


def _error_detail(response: httpx.Response) -> str | None:
    """Return only Salesforce's bounded error code/message, with secrets redacted."""

    try:
        payload = response.json()
    except ValueError:
        return None
    item: Any = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(item, dict):
        return None
    code = item.get("errorCode") or item.get("error")
    message = item.get("message") or item.get("error_description")
    parts = [value.strip() for value in (code, message) if isinstance(value, str) and value.strip()]
    if not parts:
        return None
    return _SENSITIVE_TEXT.sub(r"\1=[redacted]", ": ".join(parts))[:600]


@dataclass(frozen=True)
class CompositeWriteResult:
    quote_id: str
    task_id: str


class SalesforceClient:
    """Authenticate once for a one-shot process and expose REST primitives."""

    def __init__(self, domain: str, client_id: str, client_secret: str, api_version: str, *, http_client: httpx.Client | None = None) -> None:
        if not domain or not client_id or not client_secret or not api_version:
            raise ValueError("Salesforce domain, client ID, secret, and API version are required")
        self.domain = domain.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.api_version = api_version.lstrip("v")
        self.http = http_client or httpx.Client(timeout=60.0)
        self._access_token: str | None = None
        self.instance_url: str | None = None

    @property
    def api_root(self) -> str:
        return f"/services/data/v{self.api_version}"

    def _authenticate(self) -> None:
        response = self.http.post(
            f"{self.domain}/services/oauth2/token",
            data={"grant_type": "client_credentials", "client_id": self.client_id, "client_secret": self.client_secret},
        )
        if response.status_code >= 400:
            raise SalesforceError("Salesforce OAuth authentication failed")
        try:
            payload = response.json(
                parse_float=Decimal,
                parse_constant=_reject_json_constant,
            )
        except ValueError as exc:
            raise SalesforceResponseError("Salesforce OAuth response was malformed") from exc
        token = payload.get("access_token") if isinstance(payload, dict) else None
        instance = payload.get("instance_url") if isinstance(payload, dict) else None
        if not isinstance(token, str) or not token or not isinstance(instance, str) or not instance:
            raise SalesforceResponseError("Salesforce OAuth response did not contain required fields")
        self._access_token, self.instance_url = token, instance.rstrip("/")
        log_event("salesforce_authenticated")

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if self._access_token is None or self.instance_url is None:
            self._authenticate()
        assert self.instance_url is not None and self._access_token is not None
        response = self.http.request(method, f"{self.instance_url}{path}", headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs)
        if response.status_code >= 400:
            detail = _error_detail(response)
            suffix = f": {detail}" if detail else ""
            raise SalesforceQueryError(
                f"Salesforce REST request failed with HTTP {response.status_code}{suffix}"
            )
        try:
            payload = response.json(
                parse_float=Decimal,
                parse_constant=_reject_json_constant,
            )
        except ValueError as exc:
            raise SalesforceResponseError("Salesforce REST response was malformed") from exc
        if not isinstance(payload, dict):
            raise SalesforceResponseError("Salesforce REST response was not an object")
        return payload

    def describe(self, object_name: str) -> dict[str, Any]:
        return self._request("GET", f"{self.api_root}/sobjects/{object_name}/describe")

    def query(self, soql: str) -> list[dict[str, Any]]:
        path = f"{self.api_root}/query"
        records: list[dict[str, Any]] = []
        first = True
        while path:
            payload = self._request("GET", path, **({"params": {"q": soql}} if first else {}))
            first = False
            page = payload.get("records")
            if not isinstance(page, list) or not all(isinstance(item, dict) for item in page):
                raise SalesforceResponseError("Salesforce query response did not contain records")
            records.extend(page)
            next_path = payload.get("nextRecordsUrl")
            path = next_path if isinstance(next_path, str) and next_path else ""
        return records

    def composite_write(self, quote: QuoteCandidate, contact: ContactTarget, update: FollowUpUpdate, result: Any, *, task_description: str, business_timezone: Any = timezone.utc) -> CompositeWriteResult:
        """Atomically update the Quote and create a completed standard Task."""

        if result.quote_id != quote.quote_id:
            raise SalesforceError("call result does not match Quote")
        occurred = result.occurred_at or datetime.now(timezone.utc)
        local_date = occurred.astimezone(business_timezone).date().isoformat()
        body = {
            "allOrNone": True,
            "compositeRequest": [
                {"method": "PATCH", "url": f"{self.api_root}/sobjects/Quote/{quote.quote_id}", "referenceId": "quoteUpdate", "body": update.as_salesforce_fields()},
                {"method": "POST", "url": f"{self.api_root}/sobjects/Task", "referenceId": "taskCreate", "body": {"WhatId": quote.quote_id, "WhoId": contact.contact_id, "Status": "Completed", "Priority": "Normal", "Subject": "QuoteWake follow-up", "Description": task_description[:32000], "ActivityDate": local_date}},
            ],
        }
        payload = self._request("POST", f"{self.api_root}/composite", json=body)
        responses = payload.get("compositeResponse")
        if not isinstance(responses, list):
            raise SalesforceResponseError("Salesforce composite response was malformed")
        if any(isinstance(item, dict) and isinstance(item.get("httpStatusCode"), int) and item["httpStatusCode"] >= 300 for item in responses):
            raise SalesforceQueryError("Salesforce composite write was not successful")
        if len(responses) != 2:
            raise SalesforceResponseError("Salesforce composite response was incomplete")
        for item in responses:
            if not isinstance(item, dict) or not isinstance(item.get("httpStatusCode"), int):
                raise SalesforceQueryError("Salesforce composite write was not successful")
        task_body = responses[1].get("body") if isinstance(responses[1], dict) else None
        task_id = task_body.get("id") if isinstance(task_body, dict) else None
        if not isinstance(task_id, str) or not task_id:
            raise SalesforceResponseError("Salesforce composite response did not contain Task ID")
        log_event("salesforce_follow_up_persisted", quote_id=quote.quote_id, task_id=task_id)
        return CompositeWriteResult(quote.quote_id, task_id)
