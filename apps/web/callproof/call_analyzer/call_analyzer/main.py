from __future__ import annotations

import json
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, status

from .processing import Processor
from .queueing import Dispatcher, build_dispatcher
from .repository import Repository
from .schemas import AnalysisAccepted, AnalysisRequest, AnalysisStatus
from .settings import Settings


def create_app(settings: Settings | None = None, dispatcher: Dispatcher | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="CallProof Call Analyzer", version="0.1.0")
    app.state.settings = settings
    app.state.repository = Repository(settings.database_path)
    app.state.processor = Processor(settings, repository=app.state.repository)
    app.state.dispatcher = dispatcher or build_dispatcher(settings, app.state.processor)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "queue_mode": settings.queue_mode}

    @app.post(
        "/api/v1/analyses",
        response_model=AnalysisAccepted,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def create_analysis(payload: AnalysisRequest, request: Request) -> AnalysisAccepted:
        document = json.loads(payload.model_dump_json())
        record, created = app.state.repository.create_or_find(document)
        if created or record["status"] == "received":
            try:
                app.state.dispatcher.dispatch(record["analysis_id"])
            except Exception as error:
                raise HTTPException(status_code=503, detail="analysis queue unavailable") from error
        return AnalysisAccepted(
            analysis_id=UUID(record["analysis_id"]),
            request_id=UUID(record["request_id"]),
            status=record["status"],
            status_url=str(request.url_for("get_analysis", analysis_id=record["analysis_id"])),
        )

    @app.get("/api/v1/analyses/{analysis_id}", response_model=AnalysisStatus, name="get_analysis")
    def get_analysis(analysis_id: UUID) -> AnalysisStatus:
        record = app.state.repository.get(str(analysis_id))
        if not record:
            raise HTTPException(status_code=404, detail="analysis not found")
        result = json.loads(record["result_json"]) if record["result_json"] else None
        return AnalysisStatus(
            analysis_id=analysis_id,
            request_id=UUID(record["request_id"]),
            status=record["status"],
            result=result,
            error=record["error"],
        )

    return app


app = create_app()
