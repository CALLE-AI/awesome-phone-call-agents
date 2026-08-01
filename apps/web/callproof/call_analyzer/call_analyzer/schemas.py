from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


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


class CallContract(StrictModel):
    objective: str = Field(min_length=1, max_length=4000)
    success_conditions: list[str] = Field(min_length=1)
    allowed_commitments: dict[str, Any]
    forbidden_commitments: list[str] = []
    required_disclosures: list[str] = []
    escalation_conditions: list[str]


class Callback(StrictModel):
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def require_https(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("callback URL must use https")
        return value


class AnalysisRequest(StrictModel):
    schema_version: Literal["1.0"]
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


class Verdict(StrictModel):
    goal_completion: Literal["complete", "partial", "failed", "unknown"]
    policy_adherence: bool
    unauthorized_commitment: bool
    result_confidence: float = Field(ge=0, le=1)
    risk_score: float = Field(ge=0, le=1)
    needs_human_review: bool
    summary: str
    negotiated_terms: dict[str, Any] = {}
    missing_disclosures: list[str] = []
    contradictions: list[str] = []
    recommended_memories: list[dict[str, Any]] = []
    evidence: list[Evidence]


class AnalysisResult(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
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
