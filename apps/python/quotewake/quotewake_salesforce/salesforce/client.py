"""Small Salesforce REST/OAuth boundary used by QuoteWake."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import re
import logging
import time
from typing import Any
from urllib.parse import urlsplit

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
_API_VERSION_PATH = re.compile(r"/services/data/v[0-9]+(?:\.[0-9]+)?")
_SALESFORCE_ID = re.compile(r"^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$")


def _safe_route(path: object) -> str:
    """Return a route template without hosts, query strings, or record IDs."""

    parsed = urlsplit(str(path))
    route = parsed.path or "/"
    route = _API_VERSION_PATH.sub("/services/data/v{version}", route)
    parts = route.split("/")
    for index, part in enumerate(parts):
        if index and parts[index - 1] == "query" and part:
            parts[index:] = ["{locator}"]
            break
        # Object API names are also path segments and may be custom names.
        # Skip the segment immediately after ``sobjects`` so a 15/18-character
        # object name is retained; any ID segment that follows it is masked.
        if (
            index
            and parts[index - 1] != "sobjects"
            and _SALESFORCE_ID.fullmatch(part)
        ):
            parts[index] = "{id}"
    return "/".join(parts) or "/"


def _operation_for_route(path: object) -> str:
    route = _safe_route(path)
    if "/query" in route:
        return "query"
    if "/composite" in route:
        return "composite_write"
    if route.endswith("/describe"):
        return "describe"
    return "rest_request"


def _elapsed_ms(started: float) -> float:
    return round(max(0.0, time.perf_counter() - started) * 1000, 2)


def _log_api_boundary(
    event: str,
    *,
    operation: str,
    method: str,
    route: str,
    http_status: int | None,
    elapsed_ms: float,
    error_type: str | None = None,
) -> None:
    """Log an API boundary using only safe, operational metadata."""

    fields: dict[str, object] = {
        "service": "salesforce",
        "operation": operation,
        "method": method.upper(),
        "route": route,
        "path": route,
        "http_status": http_status,
        "elapsed_ms": elapsed_ms,
    }
    if error_type is not None:
        fields["error_type"] = error_type
    log_event(event, level=logging.DEBUG, **fields)
    # Keep detailed request/response boundaries in DEBUG, while exposing the
    # completed high-level Salesforce operation at normal INFO verbosity.
    if event == "salesforce_response_received":
        log_event("salesforce_operation_completed", level=logging.INFO, **fields)


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
        route = "/services/oauth2/token"
        started = time.perf_counter()
        _log_api_boundary(
            "salesforce_request_started",
            operation="authenticate",
            method="POST",
            route=route,
            http_status=None,
            elapsed_ms=0,
        )
        try:
            response = self.http.post(
                f"{self.domain}{route}",
                data={"grant_type": "client_credentials", "client_id": self.client_id, "client_secret": self.client_secret},
            )
        except Exception as exc:
            _log_api_boundary(
                "salesforce_response_received",
                operation="authenticate",
                method="POST",
                route=route,
                http_status=None,
                elapsed_ms=_elapsed_ms(started),
                error_type=type(exc).__name__,
            )
            raise
        _log_api_boundary(
            "salesforce_response_received",
            operation="authenticate",
            method="POST",
            route=route,
            http_status=response.status_code,
            elapsed_ms=_elapsed_ms(started),
        )
        if response.status_code >= 400:
            detail = _error_detail(response)
            suffix = f": {detail}" if detail else ""
            raise SalesforceError(f"Salesforce OAuth authentication failed{suffix}")
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
        route = _safe_route(path)
        operation = _operation_for_route(path)
        started = time.perf_counter()
        _log_api_boundary(
            "salesforce_request_started",
            operation=operation,
            method=method,
            route=route,
            http_status=None,
            elapsed_ms=0,
        )
        try:
            response = self.http.request(method, f"{self.instance_url}{path}", headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs)
        except Exception as exc:
            _log_api_boundary(
                "salesforce_response_received",
                operation=operation,
                method=method,
                route=route,
                http_status=None,
                elapsed_ms=_elapsed_ms(started),
                error_type=type(exc).__name__,
            )
            raise
        _log_api_boundary(
            "salesforce_response_received",
            operation=operation,
            method=method,
            route=route,
            http_status=response.status_code,
            elapsed_ms=_elapsed_ms(started),
        )
        if response.status_code >= 400:
            detail = _error_detail(response)
            suffix = f": {detail}" if detail else ""
            raise SalesforceQueryError(
                f"Salesforce REST request failed with HTTP {response.status_code}{suffix}"
            )
        if response.status_code == 204 or not response.content:
            return {}
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
        if not getattr(result, "binding_verified", False):
            raise SalesforceError("call result has no verified CALL-E binding")
        if result.bound_phone != contact.phone:
            raise SalesforceError("call result does not match Contact phone")
        if not isinstance(result.provider_key, str) or not result.provider_key:
            raise SalesforceError("call result has no verified provider key")
        if not isinstance(result.binding_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", result.binding_digest):
            raise SalesforceError("call result has no verified binding digest")
        if not isinstance(result.bound_task, str) or not result.bound_task:
            raise SalesforceError("call result has no verified task binding")
        if not isinstance(result.bound_schema_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", result.bound_schema_digest):
            raise SalesforceError("call result has no verified schema binding")
        metadata = dict(result.bound_metadata or ())
        expected_metadata = {
            "quotewake_quote_id": quote.quote_id,
            "quotewake_opportunity_id": quote.opportunity_id,
            "quotewake_contact_id": contact.contact_id,
            "quotewake_binding_digest": result.binding_digest,
        }
        if metadata != expected_metadata:
            raise SalesforceError("call result metadata does not match Salesforce records")
        occurred = result.occurred_at or datetime.now(timezone.utc)
        local_date = occurred.astimezone(business_timezone).date().isoformat()
        outcome = str(getattr(result, "outcome", "unknown")).strip() or "unknown"
        task_subject = f"QuoteWake call outcome: {outcome}"
        if outcome == "unknown":
            task_subject += " (human review)"
        body = {
            "allOrNone": True,
            "compositeRequest": [
                {"method": "PATCH", "url": f"{self.api_root}/sobjects/Quote/{quote.quote_id}", "referenceId": "quoteUpdate", "body": update.as_salesforce_fields()},
                {"method": "POST", "url": f"{self.api_root}/sobjects/Task", "referenceId": "taskCreate", "body": {"WhatId": quote.quote_id, "WhoId": contact.contact_id, "Status": "Completed", "Priority": "Normal", "Subject": task_subject, "Description": task_description[:32000], "ActivityDate": local_date}},
            ],
        }
        payload = self._request("POST", f"{self.api_root}/composite", json=body)
        responses = payload.get("compositeResponse")
        if not isinstance(responses, list):
            raise SalesforceResponseError("Salesforce composite response was malformed")
        failed = [
            item for item in responses
            if isinstance(item, dict)
            and isinstance(item.get("httpStatusCode"), int)
            and item["httpStatusCode"] >= 300
        ]
        if failed:
            references = ", ".join(str(item.get("referenceId", "unknown")) for item in failed)
            details: list[str] = []
            for item in failed:
                body = item.get("body")
                if isinstance(body, list):
                    for error in body:
                        if isinstance(error, dict):
                            code = error.get("errorCode")
                            message = error.get("message")
                            if isinstance(code, str) or isinstance(message, str):
                                details.append(f"{code or 'ERROR'}: {message or 'Salesforce rejected the request'}")
                elif isinstance(body, dict):
                    code = body.get("errorCode")
                    message = body.get("message")
                    if isinstance(code, str) or isinstance(message, str):
                        details.append(f"{code or 'ERROR'}: {message or 'Salesforce rejected the request'}")
            suffix = f" ({'; '.join(details)})" if details else ""
            task_is_unavailable = any(
                "entity type cannot be inserted: Task" in detail
                for detail in details
            )
            if task_is_unavailable:
                # Some Salesforce licenses cannot insert Activities even when
                # the Task object is visible. Persist the Quote state
                # independently because it is the required source of truth.
                self._request(
                    "PATCH",
                    f"{self.api_root}/sobjects/Quote/{quote.quote_id}",
                    json=update.as_salesforce_fields(),
                )
                log_event(
                    "salesforce_task_unavailable",
                    quote_id=quote.quote_id,
                    reason="The runtime Salesforce license cannot insert Task records",
                )
                log_event("salesforce_follow_up_persisted", quote_id=quote.quote_id)
                return CompositeWriteResult(quote.quote_id, "")
            raise SalesforceQueryError(
                f"Salesforce composite write failed for {references}{suffix}"
            )
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
