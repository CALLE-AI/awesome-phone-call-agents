"""
Veyra's workflow-authoring engine (FastAPI, Python — deliberately separate from the
Next.js app). Owns generation, validation, natural-language editing and compilation of
the Workflow graph. It never talks to CALL-E and never sees CALLE_API_KEY, Supabase
credentials, campaigns, contacts, or webhooks — those stay in the Next.js app per
CLAUDE.md. This service is stateless: nothing here is persisted, every endpoint is a
pure function of its request body.

Run with: uvicorn app.main:app --reload --port 8008
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ValidationError

from app.calle_schema import CalleSchemaError
from app.compiler import UnsupportedCallFeatureError, compile_workflow
from app.config import settings
from app.generator import WorkflowGenerationError, edit_workflow, generate_workflow
from app.graph_validation import ValidationResult, validate_graph
from app.models.campaign import CalleCallRequest, Contact
from app.models.workflow import Workflow

app = FastAPI(title="Veyra Engine", version="0.1.0")


def require_shared_secret(authorization: str | None = Header(default=None)) -> None:
    """No-op when ENGINE_SHARED_SECRET is unset (local dev). When set, the Next.js app
    must send it as `Authorization: Bearer <secret>`."""
    if not settings.shared_secret:
        return
    expected = f"Bearer {settings.shared_secret}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")


class GenerateRequest(BaseModel):
    prompt: str


class EditRequest(BaseModel):
    workflow: dict
    instruction: str


class ValidateRequest(BaseModel):
    workflow: dict


class CompileRequest(BaseModel):
    workflow: dict
    campaign_id: str
    contact: Contact
    webhook_url: str
    locale: str = "en-IN"


class WorkflowWithChecks(BaseModel):
    workflow: Workflow
    errors: list[str]
    warnings: list[str]


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[str]
    warnings: list[str]


def _parse_workflow(raw: dict) -> Workflow:
    try:
        return Workflow.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def _with_checks(workflow: Workflow) -> WorkflowWithChecks:
    result: ValidationResult = validate_graph(workflow)
    return WorkflowWithChecks(workflow=workflow, errors=result.errors, warnings=result.warnings)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post(
    "/workflows/generate",
    response_model=WorkflowWithChecks,
    dependencies=[Depends(require_shared_secret)],
)
def generate(request: GenerateRequest) -> WorkflowWithChecks:
    try:
        workflow = generate_workflow(request.prompt)
    except WorkflowGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _with_checks(workflow)


@app.post(
    "/workflows/edit",
    response_model=WorkflowWithChecks,
    dependencies=[Depends(require_shared_secret)],
)
def edit(request: EditRequest) -> WorkflowWithChecks:
    workflow = _parse_workflow(request.workflow)
    try:
        edited = edit_workflow(workflow, request.instruction)
    except WorkflowGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _with_checks(edited)


@app.post(
    "/workflows/validate",
    response_model=ValidateResponse,
    dependencies=[Depends(require_shared_secret)],
)
def validate(request: ValidateRequest) -> ValidateResponse:
    workflow = _parse_workflow(request.workflow)
    result = validate_graph(workflow)
    return ValidateResponse(valid=result.valid, errors=result.errors, warnings=result.warnings)


@app.post(
    "/workflows/compile",
    response_model=CalleCallRequest,
    dependencies=[Depends(require_shared_secret)],
)
def compile_endpoint(request: CompileRequest) -> CalleCallRequest:
    workflow = _parse_workflow(request.workflow)
    graph_result = validate_graph(workflow)
    if not graph_result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Workflow has graph errors, fix before compiling",
                "errors": graph_result.errors,
            },
        )
    try:
        return compile_workflow(
            workflow, request.campaign_id, request.contact, request.webhook_url, request.locale
        )
    except CalleSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except UnsupportedCallFeatureError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
