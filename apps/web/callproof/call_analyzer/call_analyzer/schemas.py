from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TranscriptTurn(StrictModel):
    id: int = Field(ge=1)
    speaker: Literal["agent", "recipient", "system", "unknown"]
    text: str = Field(min_length=1)
    started_at_ms: int | None = Field(default=None, ge=0)
    ended_at_ms: int | None = Field(default=None, ge=0)


class Transcript(StrictModel):
    language: str = Field(pattern=r"^[a-z]{2,3}(-[A-Z]{2})?$")
    turns: list[TranscriptTurn] = Field(min_length=1)


class SuccessClaim(StrictModel):
    kind: Literal["success"]
    id: Literal["delivery_date_confirmed", "delivery_time_confirmed"]
    result_field: Literal["delivery_date", "delivery_time"]
    operator: Literal["equals"] = "equals"
    expected: str = Field(pattern=r"^(\d{4}-\d{2}-\d{2}|(?:[01]\d|2[0-3]):[0-5]\d)$")

    @model_validator(mode="after")
    def bind_id_to_field_and_value_shape(self) -> "SuccessClaim":
        expected_field = {
            "delivery_date_confirmed": "delivery_date",
            "delivery_time_confirmed": "delivery_time",
        }[self.id]
        if self.result_field != expected_field:
            raise ValueError(f"{self.id} must bind {expected_field}")
        if self.id == "delivery_date_confirmed" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.expected):
            raise ValueError("delivery date must use YYYY-MM-DD")
        if self.id == "delivery_date_confirmed":
            try:
                date.fromisoformat(self.expected)
            except ValueError as error:
                raise ValueError("delivery date must be a real calendar date") from error
        if self.id == "delivery_time_confirmed" and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", self.expected):
            raise ValueError("delivery time must use HH:MM")
        return self


class CommitmentLimitClaim(StrictModel):
    kind: Literal["commitment_limit"]
    id: Literal["surcharge_within_limit"]
    result_field: Literal["surcharge_cents"]
    operator: Literal["less_than_or_equal"] = "less_than_or_equal"
    maximum: int = Field(ge=0)


class RequiredDisclosureClaim(StrictModel):
    kind: Literal["required_disclosure"]
    id: Literal["recording_notice"]


class ForbiddenCommitmentClaim(StrictModel):
    kind: Literal["forbidden_commitment"]
    id: Literal["product_substitution"]
    evaluation_mode: Literal["semantic_only"] = "semantic_only"


VerificationClaim = Annotated[
    SuccessClaim | CommitmentLimitClaim | RequiredDisclosureClaim | ForbiddenCommitmentClaim,
    Field(discriminator="kind"),
]


class AllowedCommitments(StrictModel):
    maximum_surcharge_cents: int = Field(ge=0)


class CallContract(StrictModel):
    objective: str = Field(min_length=1, max_length=4000)
    protocol_language: Literal["en", "es"]
    success_conditions: list[str] = Field(min_length=1)
    allowed_commitments: AllowedCommitments
    forbidden_commitments: list[str] = []
    required_disclosures: list[str] = []
    escalation_conditions: list[str]
    verification_claims: list[VerificationClaim] = Field(min_length=1)

    @model_validator(mode="after")
    def require_claim_for_every_declared_rule(self) -> "CallContract":
        ids = [claim.id for claim in self.verification_claims]
        if len(ids) != len(set(ids)):
            raise ValueError("verification claim ids must be unique")

        expected = {
            "success": set(self.success_conditions),
            "required_disclosure": set(self.required_disclosures),
            "forbidden_commitment": set(self.forbidden_commitments),
        }
        actual = {
            kind: {claim.id for claim in self.verification_claims if claim.kind == kind}
            for kind in expected
        }
        for kind, declared in expected.items():
            if declared != actual[kind]:
                raise ValueError(
                    f"{kind} rules and verification claims must match exactly: "
                    f"declared={sorted(declared)!r}, claims={sorted(actual[kind])!r}"
                )
        if self.escalation_conditions:
            raise ValueError(
                "free-form escalation_conditions are not supported in contract v2; "
                "encode the boundary as a typed verification claim"
            )

        commitment_claims = [
            claim for claim in self.verification_claims if claim.kind == "commitment_limit"
        ]
        if len(commitment_claims) != 1:
            raise ValueError("contract v2 requires exactly one typed commitment limit")
        commitment = commitment_claims[0]
        if commitment.result_field != "surcharge_cents":
            raise ValueError("typed commitment limit must bind surcharge_cents")
        if commitment.maximum != self.allowed_commitments.maximum_surcharge_cents:
            raise ValueError("typed commitment maximum must match allowed_commitments")
        return self


class Callback(StrictModel):
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def require_https(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("callback URL must use https")
        return value


class AnalysisRequest(StrictModel):
    schema_version: Literal["2.0"]
    request_id: UUID
    call_id: str = Field(min_length=1, max_length=255)
    agentkit_run_id: str | None = Field(default=None, max_length=255)
    submitted_at: datetime
    call_contract: CallContract
    transcript: Transcript
    provider_result: dict[str, Any] | None = None
    callback: Callback
    metadata: dict[str, Any] = {}


class Evidence(StrictModel):
    finding: str
    turn_ids: list[int] = Field(min_length=1)
    explanation: str


class ClaimResult(StrictModel):
    claim_id: str
    kind: Literal["success", "commitment_limit", "required_disclosure", "forbidden_commitment"]
    status: Literal["supported", "contradicted", "violated", "absent", "ambiguous", "unevaluated"]
    expected: Any | None = None
    actual: Any | None = None
    turn_ids: list[int] = []
    explanation: str


class Verdict(StrictModel):
    goal_completion: Literal["complete", "partial", "failed", "unknown"]
    policy_adherence: bool
    policy_evaluation: Literal["compliant", "violated", "unknown"]
    unauthorized_commitment: bool
    result_confidence: float = Field(ge=0, le=1)
    risk_score: float = Field(ge=0, le=1)
    needs_human_review: bool
    summary: str
    negotiated_terms: dict[str, Any] = {}
    missing_disclosures: list[str] = []
    contradictions: list[str] = []
    recommended_memories: list[dict[str, Any]] = []
    claim_results: list[ClaimResult]
    evidence: list[Evidence]


class AnalysisResult(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    analysis_id: UUID
    request_id: UUID
    call_id: str
    agentkit_run_id: str | None = None
    status: Literal["completed"] = "completed"
    completed_at: datetime
    verdict: Verdict
    metrics: dict[str, Any] = {}


class AnalysisAccepted(StrictModel):
    analysis_id: UUID
    request_id: UUID
    status: Literal["received", "analyzing", "completed", "failed"]
    status_url: str


class AnalysisStatus(StrictModel):
    analysis_id: UUID
    request_id: UUID
    status: Literal["received", "analyzing", "completed", "failed"]
    result: AnalysisResult | None = None
    error: str | None = None
