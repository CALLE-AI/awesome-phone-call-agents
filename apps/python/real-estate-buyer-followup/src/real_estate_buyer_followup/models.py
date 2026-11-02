"""Validated domain contracts. Model suggestions never write CRM directly."""
from typing import Any, Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Insight(Strict):
    category: Literal["fact", "hypothesis", "conflict", "gap"]
    text: str
    source_ids: list[str] = Field(min_length=1)
    confidence: Literal["high", "medium", "low"] = "medium"
    action: str = ""


class PolicyUse(Strict):
    source_id: str
    excerpt: str = ""
    paragraph_indices: list[Annotated[int, Field(ge=0)]] = Field(default_factory=list, max_length=3)
    reason: str = Field(min_length=1)


class PolicySelection(Strict):
    policy_uses: list[PolicyUse] = Field(max_length=5)
    policy_questions: list[str]


class Assessment(Strict):
    summary: str
    insights: list[Insight]
    selected_sources: list[str]
    excluded: list[dict[str, str]]
    policy_uses: list[PolicyUse] = Field(default_factory=list, max_length=5)
    policy_questions: list[str] = Field(default_factory=list)


class Question(Strict):
    question: str
    priority: Literal["high", "medium", "low"]
    reason: str
    source_ids: list[str] = Field(min_length=1)
    expected_information: str


class CommunicationTopic(Strict):
    """A conversation direction, not a script of individual questions."""
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    source_ids: list[str] = Field(min_length=1)


class Plan(Strict):
    objective: str
    call_context: dict[str, str] = Field(default_factory=dict)
    goals: list[str] = Field(default_factory=list)
    communication_topics: list[CommunicationTopic] = Field(default_factory=list)
    # Read old saved plans without rewriting their frozen execution records.
    # New plans use communication_topics and leave questions empty.
    questions: list[Question] = Field(default_factory=list)
    skip_questions: list[str]
    verification_items: list[str]
    response_branches: list[str]
    constraints: list[str]


class Evidence(Strict):
    turn_index: int = Field(ge=0)
    quote: str = Field(min_length=1)


class PreferenceChange(Strict):
    field: Literal["budget_max", "preferred_area", "bedrooms", "living_room_priority",
                   "subway_preference", "purchase_timeline", "next_viewing_interest", "contact_allowed"]
    value: Any
    evidence: Evidence
    reason: str
    uncertain: bool = False


class Feedback(Strict):
    property_id: str
    dimension: str
    text: str
    evidence: Evidence
    uncertain: bool = False


class Signal(Strict):
    kind: Literal["revisit", "purchase", "negotiation", "interest"]
    property_id: str
    timeframe: str
    condition: str
    evidence: Evidence


class Analysis(Strict):
    summary: str
    changes: list[PreferenceChange]
    feedback: list[Feedback]
    signals: list[Signal]
    unresolved: list[str]
