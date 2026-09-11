"""Consent binding.

A consent checkbox is the wrong primitive for a table. Ticking one cell and
dragging it down a column is the single most ordinary gesture in a spreadsheet,
and it would authorise every row it touched.

So consent here is not a boolean. It is a token derived from the row's own
content:

    token = sha256(request_id | phone | relationship | spec_version | receipt_id)

`authorize()` recomputes that token from the row in front of it and compares it
with the token stored on that row. A token copied from another row was derived
from a different phone number, so it will not match, and the copy is refused.
Editing the questions changes `task_spec_version`, which invalidates every token
gathered under the previous wording -- consent is revoked by construction when
the purpose changes, which is what purpose limitation means in law.

Regulators that require this, in their own words:

  * US, FCRA -- a consumer report requires a permissible purpose; for
    employment purposes, written consent and disclosure.
  * EU/UK, GDPR -- contacting a third party about a data subject needs a lawful
    basis and purpose limitation.
  * India, RBI Guidelines on Digital Lending (2 September 2022) -- data
    collection must be "need-based and with prior and explicit consent of the
    borrower having audit trail".
"""

from __future__ import annotations

import hashlib
import hmac

from .types import (
    BoundaryError,
    ConsentedEmployerContact,
    Relationship,
    VerificationRequest,
    _build_consented_contact,
)

_SEP = "\x1f"  # unit separator: cannot appear in any component, so the
# concatenation is unambiguous and two different tuples cannot collide.


def derive_token(
    *,
    request_id: str,
    phone_e164: str,
    relationship: Relationship,
    task_spec_version: str,
    consent_receipt_id: str,
) -> str:
    """Derive the consent token for one row.

    Every component is load-bearing. Drop the phone number and the token
    survives being copied to another row; drop the spec version and edited
    questions keep old consent; drop the receipt id and a revoked consent still
    verifies.
    """
    material = _SEP.join(
        (
            request_id,
            phone_e164,
            relationship.value,
            task_spec_version,
            consent_receipt_id,
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def authorize(
    request: VerificationRequest,
    *,
    relationship: Relationship,
    task_spec_version: str,
    presented_token: str,
) -> ConsentedEmployerContact:
    """Turn a table row into something the dialer will accept.

    This is the only function in the package that produces a
    `ConsentedEmployerContact`. Every refusal below is a call that does not
    happen.
    """
    if request.cancelled:
        raise BoundaryError(f"{request.request_id}: request is cancelled")

    # Order matters for the message, not the outcome: consent is consent to a
    # *specific number* being called, so a row with no number has nothing to
    # consent to yet. Reporting the missing consent first would send an
    # operator to fix the wrong thing.
    if request.sourced is None:
        raise BoundaryError(
            f"{request.request_id}: no independently sourced employer number. "
            "The number on the application is never dialed, so this request is "
            "employer-unverifiable rather than ready to call."
        )

    if request.consent is None:
        raise BoundaryError(
            f"{request.request_id}: no consent recorded for this employer"
        )

    if not isinstance(relationship, Relationship):
        raise BoundaryError(f"{request.request_id}: unknown relationship")

    expected = derive_token(
        request_id=request.request_id,
        phone_e164=request.sourced.e164,
        relationship=relationship,
        task_spec_version=task_spec_version,
        consent_receipt_id=request.consent.receipt_id,
    )

    # Constant-time: the token is a secret in the sense that a caller should not
    # be able to grind toward a valid one by timing failures.
    if not hmac.compare_digest(expected, presented_token or ""):
        raise BoundaryError(
            f"{request.request_id}: consent token does not match this row. A "
            "token copied from another row, or gathered before the questions "
            "changed, is not consent for this call."
        )

    return _build_consented_contact(
        request_id=request.request_id,
        applicant_ref=request.applicant_ref,
        employer_name=request.employer_name,
        applicant_name=request.applicant_name,
        number=request.sourced,
        relationship=relationship,
        consent_receipt_id=request.consent.receipt_id,
        consent_token=expected,
        task_spec_version=task_spec_version,
    )
