"""
The Python mirror of types/workflow.ts. That file is the source of truth for the
schema; if it changes, this file, engine/app/graph_validation.py and
engine/app/compiler.py need to change with it, same as the TypeScript consumers
listed in its own docstring.

Wire format is camelCase (matches the TS types and what the Next.js app sends/expects).
Field names are snake_case Python-side with camelCase aliases so both
`Workflow(**camel_case_dict)` and `Workflow(goal=...)` work.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NodeType = Literal["start", "question", "decision", "terminal"]


class WorkflowNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: NodeType
    label: str
    say: str
    captures: list[str] = Field(default_factory=list)
    x: float
    y: float


class WorkflowEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    from_: str = Field(alias="from")
    to: str
    condition: str | None = None


QualificationOperator = Literal["gte", "lte", "eq", "in"]


class QualificationRule(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    field: str
    operator: QualificationOperator
    value: str | float | list[str]
    points: float


class Qualification(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rules: list[QualificationRule] = Field(default_factory=list)
    threshold: float


OutcomeFieldType = Literal["string", "number", "integer", "boolean", "object", "array"]


class OutcomeField(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    type: OutcomeFieldType
    description: str | None = None
    enum_values: list[str] | None = Field(default=None, alias="enumValues")
    required: bool = False
    items: OutcomeField | None = None
    properties: list[OutcomeField] | None = None


OutcomeField.model_rebuild()


class OutcomeSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fields: list[OutcomeField] = Field(default_factory=list)
    next_step: list[str] = Field(default_factory=list, alias="nextStep")


class Workflow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str | None = None
    goal: str
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    qualification: Qualification
    outcome_schema: OutcomeSchema = Field(alias="outcomeSchema")
