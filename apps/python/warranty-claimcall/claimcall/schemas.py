"""Input and output contracts for the ClaimCall CLI.

The claim file a user writes is deliberately small and flat - the point of this
tool is that you can describe a warranty claim in twenty lines of JSON and get
a safety-gated, consented phone call out of it.

The result schema handed to CALL-E, and the domain types, come from
`claimcall_core` so this CLI and the ClaimPilot product cannot drift apart.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from claimcall_core import CALL_RESULT_SCHEMA, RESULT_SCHEMA_ID
from claimcall_core.hashing import canonical_json, sha256_text
from claimpilot_contracts import (
    AppointmentWindow,
    CallManifest,
    CallResult,
    Claim,
    DisclosureField,
    EvidenceFact,
    FactReviewState,
    FactSource,
    FeeLimit,
)
from pydantic import BaseModel, Field

__all__ = [
    "CALL_RESULT_SCHEMA",
    "RESULT_SCHEMA_ID",
    "AppointmentWindow",
    "CallManifest",
    "CallResult",
    "ClaimFile",
    "claim_id_for",
    "DisclosureField",
    "EvidenceFact",
    "FeeLimit",
    "to_claim_and_facts",
]


class ProductInput(BaseModel):
    brand: str | None = None
    name: str | None = None
    model: str | None = None
    serial_number: str | None = None
    purchase_date: str | None = Field(default=None, description="ISO date, YYYY-MM-DD")
    invoice_number: str | None = None
    seller: str | None = None


class RecipientInput(BaseModel):
    organization: str
    phone_e164: str = Field(description="E.164. Use a reserved test number in examples.")


class ClaimFile(BaseModel):
    """One warranty claim, as a user writes it."""

    owner_display_name: str
    issue: str = Field(min_length=3, max_length=1200)
    product: ProductInput
    recipient: RecipientInput
    language: str = "en-IN"
    approved_windows: list[AppointmentWindow] = Field(default_factory=list)
    max_fee: float = Field(
        default=0.0,
        ge=0.0,
        description="Maximum fee the agent may accept. Zero means it may accept none.",
    )
    currency: str = "INR"
    questions: list[str] = Field(default_factory=list, max_length=4)
    synthetic: bool = True


def claim_id_for(source: ClaimFile) -> str:
    """A stable claim id derived from the claim's identity, not its wording.

    The CLI has no database, so `preview` in one shell and `run --live --confirm`
    in another must agree on the plan hash and the idempotency key. A random id
    would break that, and worse, would let a user place a second call to the
    same desk about the same product just by rephrasing a question.

    Identity here means: who is calling, about which unit, at which desk. Change
    any of those and it is genuinely a different call. Reword a question and the
    plan hash changes - so consent must be given again - but the idempotency key
    does not, so the second call is still recognised as the same call.
    """
    identity = canonical_json(
        {
            "owner": source.owner_display_name.strip().lower(),
            "recipient": source.recipient.phone_e164.strip(),
            "organization": source.recipient.organization.strip().lower(),
            "serial": (source.product.serial_number or "").strip().lower(),
            "invoice": (source.product.invoice_number or "").strip().lower(),
            "product": (source.product.name or "").strip().lower(),
            "purchase_date": (source.product.purchase_date or "").strip(),
        }
    )
    return f"clm_{sha256_text(identity)[:16]}"


def to_claim_and_facts(source: ClaimFile) -> tuple[Claim, list[EvidenceFact]]:
    """Turn a claim file into the domain objects the engine compiles from.

    Every product value becomes an *accepted* fact whose source is
    `claim_file` - explicit provenance, because the manifest compiler only
    discloses reviewed facts and this is what "reviewed" means for a CLI where
    the user typed the values themselves.
    """
    claim = Claim(
        id=claim_id_for(source),
        owner_display_name=source.owner_display_name,
        issue_description=source.issue,
        preferred_language=source.language,
        service_number_e164=source.recipient.phone_e164,
        service_organization=source.recipient.organization,
        preferred_windows=list(source.approved_windows),
        synthetic=source.synthetic,
    )

    now = datetime.now(UTC)
    facts: list[EvidenceFact] = []
    for field_name, label in (
        ("brand", "Brand"),
        ("name", "Product"),
        ("model", "Model"),
        ("serial_number", "Serial number"),
        ("purchase_date", "Purchase date"),
        ("invoice_number", "Invoice number"),
        ("seller", "Seller"),
    ):
        value = getattr(source.product, field_name, None)
        if not value:
            continue
        facts.append(
            EvidenceFact(
                claim_id=claim.id,
                path=f"product.{field_name}",
                label=label,
                raw_value=str(value),
                normalized_value=str(value).strip(),
                confidence=1.0,
                review_state=FactReviewState.ACCEPTED,
                source=FactSource(provider="claim_file", retrieved_at=now, snippet=str(value)),
                critical=field_name in {"purchase_date", "name", "serial_number"},
            )
        )
    return claim, facts


def default_expiry(minutes: int = 15) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes)


def json_safe(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    return value
