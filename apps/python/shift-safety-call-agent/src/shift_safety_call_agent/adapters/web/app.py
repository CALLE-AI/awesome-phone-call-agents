"""Application factory for the local Fake Provider Web API."""

from collections.abc import Callable
from datetime import datetime
from urllib.parse import quote
from uuid import uuid4

from fastapi import FastAPI, Query, Response, status

from shift_safety_call_agent.adapters.fake_call_provider import FakeCallProvider
from shift_safety_call_agent.adapters.web.errors import install_error_handlers
from shift_safety_call_agent.adapters.web.mapping import (
    to_interview_detail,
    to_interview_summary,
)
from shift_safety_call_agent.adapters.web.schemas import (
    ErrorResponse,
    FakeInterviewRequest,
    HealthResponse,
    InterviewDetailResponse,
    InterviewListResponse,
    ReviewCountsResponse,
    ScenarioResponse,
    ServiceInfoResponse,
)
from shift_safety_call_agent.adapters.web.static_files import install_static_ui_routes
from shift_safety_call_agent.application.ports import InterviewRepository
from shift_safety_call_agent.application.repository_errors import InterviewNotFoundError
from shift_safety_call_agent.application.services import InterviewService, utc_now
from shift_safety_call_agent.application.review_triage import (
    derive_interview_review_disposition,
)
from shift_safety_call_agent.domain.enums import (
    IncidentLevel,
    InterviewStatus,
    ReviewDisposition,
)
from shift_safety_call_agent.domain.models import SafetyInterview


API_PREFIX = "/api/v1"

_SCENARIOS = (
    ScenarioResponse(
        id="no-incident",
        display_name="No incident",
        description="A fictional shift with no reported safety issue.",
    ),
    ScenarioResponse(
        id="minor-near-miss",
        display_name="Minor near miss",
        description="A fictional handling task with a reported near miss.",
    ),
    ScenarioResponse(
        id="equipment-follow-up",
        display_name="Equipment follow-up",
        description="A fictional tool concern requiring follow-up.",
    ),
    ScenarioResponse(
        id="incomplete-answers",
        display_name="Incomplete answers",
        description="A fictional interview whose answers remain unknown.",
    ),
)

_COMMON_ERRORS = {
    422: {"model": ErrorResponse},
    500: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


def _new_id() -> str:
    return str(uuid4())


def create_app(
    *,
    repository: InterviewRepository,
    app_version: str,
    fake_service_factory: Callable[[], InterviewService] | None = None,
    clock: Callable[[], datetime] = utc_now,
    id_generator: Callable[[], str] = _new_id,
) -> FastAPI:
    """Create an injected app without opening a database or starting a server."""

    service_factory = fake_service_factory or (
        lambda: InterviewService(FakeCallProvider(), repository, clock)
    )
    app = FastAPI(
        title="Shift Safety Call Agent Local API",
        version=app_version,
        description="Local-only Fake Provider API with SQLite persistence.",
    )
    install_error_handlers(app)
    install_static_ui_routes(app)

    @app.get("/", response_model=ServiceInfoResponse)
    def service_info() -> ServiceInfoResponse:
        return ServiceInfoResponse(
            service="Shift Safety Call Agent Local API",
            version=app_version,
            api_prefix=API_PREFIX,
            provider="fake",
            real_calls_enabled=False,
        )

    @app.get(
        f"{API_PREFIX}/health",
        response_model=HealthResponse,
        responses={500: _COMMON_ERRORS[500], 503: _COMMON_ERRORS[503]},
    )
    def health() -> HealthResponse:
        repository.list()
        return HealthResponse(
            status="ok",
            version=app_version,
            storage="sqlite",
            provider="fake",
            real_calls_enabled=False,
        )

    @app.get(
        f"{API_PREFIX}/scenarios",
        response_model=tuple[ScenarioResponse, ...],
        responses={500: _COMMON_ERRORS[500]},
    )
    def scenarios() -> tuple[ScenarioResponse, ...]:
        return _SCENARIOS

    @app.post(
        f"{API_PREFIX}/interviews/fake",
        response_model=InterviewDetailResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            409: {"model": ErrorResponse},
            **_COMMON_ERRORS,
        },
    )
    def create_fake_interview(
        request: FakeInterviewRequest, response: Response
    ) -> InterviewDetailResponse:
        interview = SafetyInterview(
            interview_id=id_generator(),
            created_at=clock(),
            scenario_name=request.scenario.value,
            recipient_alias=request.recipient_alias,
        )
        completed = service_factory().execute(interview)
        response.headers["Location"] = (
            f"{API_PREFIX}/interviews/{quote(completed.interview_id, safe='')}"
        )
        return to_interview_detail(completed)

    @app.get(
        f"{API_PREFIX}/interviews",
        response_model=InterviewListResponse,
        responses=_COMMON_ERRORS,
    )
    def list_interviews(
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        interview_status: InterviewStatus | None = Query(default=None, alias="status"),
        incident_level: IncidentLevel | None = Query(default=None),
        requires_follow_up: bool | None = Query(default=None),
        review_disposition: ReviewDisposition | None = Query(default=None),
    ) -> InterviewListResponse:
        interviews = repository.list()
        dispositions = {
            interview.interview_id: derive_interview_review_disposition(interview)
            for interview in interviews
        }
        filtered = tuple(
            interview
            for interview in interviews
            if (interview_status is None or interview.status is interview_status)
            and (
                incident_level is None
                or (
                    interview.result is not None
                    and interview.result.incident_level is incident_level
                )
            )
            and (
                requires_follow_up is None
                or (
                    interview.result is not None
                    and interview.result.requires_follow_up is requires_follow_up
                )
            )
            and (
                review_disposition is None
                or dispositions[interview.interview_id] is review_disposition
            )
        )
        page = filtered[offset : offset + limit]
        return InterviewListResponse(
            items=tuple(to_interview_summary(interview) for interview in page),
            count=len(filtered),
            limit=limit,
            offset=offset,
            review_counts=ReviewCountsResponse(
                **{
                    disposition.value: sum(
                        value is disposition for value in dispositions.values()
                    )
                    for disposition in ReviewDisposition
                }
            ),
        )

    @app.get(
        f"{API_PREFIX}/interviews/{{interview_id}}",
        response_model=InterviewDetailResponse,
        responses={404: {"model": ErrorResponse}, **_COMMON_ERRORS},
    )
    def get_interview(interview_id: str) -> InterviewDetailResponse:
        interview = repository.get(interview_id)
        if interview is None:
            raise InterviewNotFoundError("Interview not found")
        return to_interview_detail(interview)

    return app
