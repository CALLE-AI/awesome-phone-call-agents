"""Recording that an applicant consented to a specific employer being called.

The consent token is a hash, so nobody can type one into a spreadsheet. In a
real deployment it is written by whatever system captured the applicant's
signature. But an operator adding a row by hand had no way to produce one at
all, which made a correctly-configured base unusable.

This is deliberately *recording* a consent that already happened, not creating
one. The operator is attesting, on the record, that the applicant named this
employer and agreed to it being contacted, and the attestation goes into the
audit chain under their own disclosure version. Nothing here can invent
consent: a row without an applicant, an employer or an independently sourced
number cannot be granted, because there is nothing coherent to consent to.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .airtable import AirtableClient, FieldMap, Row
from .audit import AuditLog
from .consent import derive_token
from .tasks import TASK_SPEC_VERSION
from .types import Relationship


class GrantError(Exception):
    """Consent could not be recorded for this row."""


@dataclass(frozen=True, slots=True)
class Grant:
    record_id: str
    request_id: str
    receipt_id: str
    disclosure_version: str
    signed_at: str


def _receipt_id(request_id: str, phone: str, signed_at: str) -> str:
    """Stable, readable, and derived rather than sequential.

    A counter would collide across machines; a random id would make the same
    grant look different on a re-run. This is reproducible from its inputs.
    """
    digest = hashlib.sha256(f"{request_id}\x1f{phone}\x1f{signed_at}".encode()).hexdigest()
    return f"CR-{digest[:10].upper()}"


def grant_consent(
    client: AirtableClient,
    audit: AuditLog,
    *,
    table: str,
    row: Row,
    disclosure_version: str,
    fields: FieldMap | None = None,
    now: datetime | None = None,
) -> Grant:
    """Record consent for one row and write the derived token back."""
    fields = fields or FieldMap()
    request = row.request

    if not disclosure_version.strip():
        raise GrantError(
            "a disclosure version is required: it records which wording the "
            "applicant actually agreed to, and it is part of the token"
        )
    if request.cancelled:
        raise GrantError(f"{request.request_id}: request is cancelled")
    if not request.applicant_name.strip():
        raise GrantError(
            f"{request.request_id}: no applicant name. Employment cannot be "
            "verified without naming the person, so there is nothing to consent to."
        )
    if not request.employer_name.strip():
        raise GrantError(f"{request.request_id}: no employer named")
    if request.sourced is None:
        raise GrantError(
            f"{request.request_id}: no independently sourced employer number. "
            "Consent is to a specific number being called, so it cannot be "
            "recorded before one exists."
        )

    signed_at = (now or datetime.now(timezone.utc)).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    receipt_id = _receipt_id(request.request_id, request.sourced.e164, signed_at)

    token = derive_token(
        request_id=request.request_id,
        phone_e164=request.sourced.e164,
        relationship=Relationship.EMPLOYER,
        task_spec_version=TASK_SPEC_VERSION,
        consent_receipt_id=receipt_id,
    )

    audit.append(
        "consent.recorded",
        request_id=request.request_id,
        masked_number=request.sourced.masked(),
        number_source=request.sourced.source.value,
        consent_token=token,
        detail={
            "employer": request.employer_name,
            "receipt_id": receipt_id,
            "disclosure_version": disclosure_version,
            "signed_at": signed_at,
            "task_spec_version": TASK_SPEC_VERSION,
        },
    )

    updates: list[dict[str, Any]] = [
        {
            "id": row.record_id,
            "fields": {
                fields.consent_receipt_id: receipt_id,
                fields.consent_disclosure_version: disclosure_version,
                fields.consent_signed_at: signed_at,
                fields.consent_token: token,
                fields.status: "ready",
                fields.reason: "",
            },
        }
    ]
    client.update_records(table, updates)

    return Grant(
        record_id=row.record_id,
        request_id=request.request_id,
        receipt_id=receipt_id,
        disclosure_version=disclosure_version,
        signed_at=signed_at,
    )


def revoke_consent(
    client: AirtableClient,
    audit: AuditLog,
    *,
    table: str,
    row: Row,
    fields: FieldMap | None = None,
) -> None:
    """Clear a recorded consent, so the row can no longer be called."""
    fields = fields or FieldMap()
    audit.append(
        "consent.revoked",
        request_id=row.request.request_id,
        masked_number=row.request.sourced.masked() if row.request.sourced else "",
        consent_token=row.presented_token,
    )
    client.update_records(
        table,
        [
            {
                "id": row.record_id,
                "fields": {
                    fields.consent_receipt_id: "",
                    fields.consent_disclosure_version: "",
                    fields.consent_signed_at: "",
                    fields.consent_token: "",
                    fields.status: "consent revoked",
                },
            }
        ],
    )
