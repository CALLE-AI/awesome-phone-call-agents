"""The Airtable side: read the columns, read the rows, write the answers back.

Two things here are not incidental.

The **field definitions** are read from `GET /v0/meta/bases/{baseId}/tables`,
available on every Airtable plan including free. That endpoint is what makes
the derived schema possible: it returns each column's type, description and --
for a single select -- its choices, which is the enum.

The **view** is the unit of scope. A view can hide rows behind a filter, and a
run that silently called only what happened to be visible would be a hazard, so
`scope()` reports both counts and the caller is expected to show the operator
the difference before anything dials.

This plugin uses Airtable's Web API rather than an extension or a scripted
automation, so it runs on the free plan, where extensions and automations are
not available. The free plan's 1,000 API calls per workspace per month is a
real ceiling and is documented in the README rather than discovered later.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterable, Protocol, Sequence

from .types import (
    ApplicantSuppliedNumber,
    BoundaryError,
    ConsentReceipt,
    NumberSource,
    VerificationRequest,
    source_number,
)

AIRTABLE_ORIGIN = "api.airtable.com"
DEFAULT_BASE_URL = f"https://{AIRTABLE_ORIGIN}"
USER_AGENT = "certa/0.1 (+awesome-phone-call-agents)"

# Airtable accepts at most 10 records per write.
MAX_WRITE_BATCH = 10


class AirtableError(Exception):
    """Airtable could not be read or written."""


@dataclass(frozen=True, slots=True)
class FieldMap:
    """Column names in the operator's base.

    Defaults match `examples/base-template.json`. They are configurable
    because an existing verification base will already have its own names.
    """

    request_id: str = "Request ID"
    applicant_ref: str = "Applicant reference"
    applicant_name: str = "Applicant name"
    employer_name: str = "Employer"
    sourced_number: str = "Sourced number"
    number_source: str = "Number source"
    applicant_supplied_number: str = "Number on application"
    consent_receipt_id: str = "Consent receipt ID"
    consent_disclosure_version: str = "Consent disclosure version"
    consent_signed_at: str = "Consent signed at"
    consent_token: str = "Consent token"
    cancelled: str = "Cancelled"
    status: str = "Status"
    reason: str = "Reason"
    call_id: str = "Call ID"

    def control_columns(self) -> set[str]:
        """Columns the workflow owns. Everything else is an answer column."""
        return {
            self.request_id,
            self.applicant_ref,
            self.applicant_name,
            self.employer_name,
            self.sourced_number,
            self.number_source,
            self.applicant_supplied_number,
            self.consent_receipt_id,
            self.consent_disclosure_version,
            self.consent_signed_at,
            self.consent_token,
            self.cancelled,
            self.status,
            self.reason,
            self.call_id,
        }


@dataclass(frozen=True, slots=True)
class Scope:
    """What a run would cover, and what the view is hiding."""

    view: str
    in_view: int
    in_table: int

    @property
    def hidden(self) -> int:
        return max(self.in_table - self.in_view, 0)


@dataclass(frozen=True, slots=True)
class Row:
    """One Airtable record, kept alongside the request it maps to."""

    record_id: str
    request: VerificationRequest
    presented_token: str
    raw: dict[str, Any] = field(default_factory=dict)


class AirtableClient(Protocol):
    def table_schema(self, table: str) -> list[dict[str, Any]]: ...

    def list_view(self, table: str, view: str) -> list[dict[str, Any]]: ...

    def count_table(self, table: str) -> int: ...

    def update_records(self, table: str, updates: Sequence[dict[str, Any]]) -> None: ...


class LiveAirtable:
    """Airtable Web API over urllib. Credentials go to one origin only."""

    def __init__(
        self,
        token: str,
        base_id: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        if not token or not base_id:
            raise AirtableError("AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required")
        origin = urllib.parse.urlsplit(base_url).netloc.lower()
        if origin != AIRTABLE_ORIGIN:
            raise AirtableError(
                f"refusing to send an Airtable token to {origin!r}; "
                f"credentialed requests are restricted to {AIRTABLE_ORIGIN}"
            )
        self.token = token
        self.base_id = base_id
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self, method: str, path: str, *, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            url=f"{self.base_url}{path}", data=data, method=method
        )
        request.add_header("Authorization", f"Bearer {self.token}")
        request.add_header("Content-Type", "application/json")
        request.add_header("User-Agent", USER_AGENT)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code == 429:
                raise AirtableError(
                    "Airtable rate limit reached. The free plan allows 1,000 API "
                    "calls per workspace per month and 5 requests per second."
                ) from exc
            raise AirtableError(f"Airtable {method} {path} -> {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AirtableError(f"Airtable {method} {path} unreachable: {exc.reason}") from exc
        return json.loads(raw) if raw else {}

    def table_schema(self, table: str) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/v0/meta/bases/{self.base_id}/tables")
        for entry in payload.get("tables", []):
            if table in (entry.get("id"), entry.get("name")):
                return entry.get("fields", [])
        raise AirtableError(f"table {table!r} not found in base {self.base_id}")

    def _paged(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        offset: str | None = None
        while True:
            query = dict(params)
            if offset:
                query["offset"] = offset
            path = (
                f"/v0/{self.base_id}/{urllib.parse.quote(table)}"
                f"?{urllib.parse.urlencode(query)}"
            )
            payload = self._request("GET", path)
            records.extend(payload.get("records", []))
            offset = payload.get("offset")
            if not offset:
                return records

    def list_view(self, table: str, view: str) -> list[dict[str, Any]]:
        return self._paged(table, {"view": view, "pageSize": "100"})

    def count_table(self, table: str) -> int:
        # `fields[]=` with no field asks for record ids only, which keeps the
        # count cheap against the free plan's monthly call budget.
        return len(self._paged(table, {"pageSize": "100", "fields[]": ""}))

    def update_records(self, table: str, updates: Sequence[dict[str, Any]]) -> None:
        for start in range(0, len(updates), MAX_WRITE_BATCH):
            chunk = list(updates[start : start + MAX_WRITE_BATCH])
            self._request(
                "PATCH",
                f"/v0/{self.base_id}/{urllib.parse.quote(table)}",
                body={"records": chunk, "typecast": False},
            )


class FixtureAirtable:
    """An in-memory base. Used by every test and by `certa replay`."""

    def __init__(self, schema: list[dict[str, Any]], records: list[dict[str, Any]],
                 *, view_records: list[dict[str, Any]] | None = None) -> None:
        self._schema = schema
        self._records = records
        self._view = view_records if view_records is not None else records
        self.writes: list[dict[str, Any]] = []

    def table_schema(self, table: str) -> list[dict[str, Any]]:
        return self._schema

    def list_view(self, table: str, view: str) -> list[dict[str, Any]]:
        return list(self._view)

    def count_table(self, table: str) -> int:
        return len(self._records)

    def update_records(self, table: str, updates: Sequence[dict[str, Any]]) -> None:
        self.writes.extend(updates)


def answer_columns(
    schema: Iterable[dict[str, Any]], fields: FieldMap
) -> list[dict[str, Any]]:
    """Columns the derived result schema is built from.

    Everything the workflow does not own is an answer column, which is what
    lets an operator add a question by adding a column.
    """
    owned = fields.control_columns()
    return [column for column in schema if column.get("name") not in owned]


def to_row(record: dict[str, Any], fields: FieldMap) -> Row:
    """Map one Airtable record onto a VerificationRequest.

    The number written on the application is read into an
    `ApplicantSuppliedNumber`, which has no path to the dialer. That is the
    provenance boundary showing up at the edge of the system rather than only
    in the core.
    """
    values = record.get("fields", {}) or {}

    def get(name: str) -> str:
        raw = values.get(name)
        return "" if raw is None else str(raw).strip()

    consent: ConsentReceipt | None = None
    if get(fields.consent_receipt_id):
        try:
            consent = ConsentReceipt(
                receipt_id=get(fields.consent_receipt_id),
                disclosure_version=get(fields.consent_disclosure_version),
                signed_at=get(fields.consent_signed_at),
            )
        except BoundaryError as exc:
            raise AirtableError(
                f"{get(fields.request_id) or record.get('id')}: {exc}"
            ) from exc

    sourced = None
    raw_number = get(fields.sourced_number)
    if raw_number:
        raw_source = get(fields.number_source)
        try:
            sourced = source_number(raw_number, NumberSource(raw_source))
        except ValueError as exc:
            raise AirtableError(
                f"{get(fields.request_id)}: {raw_source!r} is not a recognised "
                f"number source. Use one of "
                f"{sorted(s.value for s in NumberSource)}."
            ) from exc
        except BoundaryError as exc:
            raise AirtableError(f"{get(fields.request_id)}: {exc}") from exc

    supplied = get(fields.applicant_supplied_number)
    request = VerificationRequest(
        request_id=get(fields.request_id) or record.get("id", ""),
        applicant_ref=get(fields.applicant_ref),
        employer_name=get(fields.employer_name),
        applicant_name=get(fields.applicant_name),
        consent=consent,
        applicant_supplied=ApplicantSuppliedNumber(raw=supplied) if supplied else None,
        sourced=sourced,
        cancelled=bool(values.get(fields.cancelled)),
    )
    return Row(
        record_id=record.get("id", ""),
        request=request,
        presented_token=get(fields.consent_token),
        raw=values,
    )


def scope(client: AirtableClient, table: str, view: str) -> Scope:
    """How many rows a run covers, and how many the view is hiding."""
    return Scope(
        view=view,
        in_view=len(client.list_view(table, view)),
        in_table=client.count_table(table),
    )
