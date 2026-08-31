"""Safe common error responses for the local Web API."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from shift_safety_call_agent.application.repository_errors import (
    DatabaseInitializationError,
    DuplicateInterviewError,
    InterviewNotFoundError,
    RepositoryDataError,
    RepositoryError,
    RepositoryOperationError,
    UnsupportedSchemaVersionError,
)


_MESSAGES = {
    "validation_error": "The request is invalid.",
    "interview_not_found": "The requested interview was not found.",
    "duplicate_interview": "An interview with this identifier already exists.",
    "repository_unavailable": "The local repository is unavailable.",
    "repository_data_error": "Stored interview data is invalid.",
    "internal_error": "The request could not be completed.",
}


def _error(status_code: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": _MESSAGES[code]}},
    )


def install_error_handlers(app: FastAPI) -> None:
    """Install handlers that never echo input, SQL, paths, or raw exceptions."""

    @app.exception_handler(RequestValidationError)
    async def validation_error(
        _request: Request, _error_value: RequestValidationError
    ) -> JSONResponse:
        return _error(422, "validation_error")

    @app.exception_handler(InterviewNotFoundError)
    async def interview_not_found(
        _request: Request, _error_value: InterviewNotFoundError
    ) -> JSONResponse:
        return _error(404, "interview_not_found")

    @app.exception_handler(DuplicateInterviewError)
    async def duplicate_interview(
        _request: Request, _error_value: DuplicateInterviewError
    ) -> JSONResponse:
        return _error(409, "duplicate_interview")

    @app.exception_handler(RepositoryDataError)
    async def repository_data_error(
        _request: Request, _error_value: RepositoryDataError
    ) -> JSONResponse:
        return _error(500, "repository_data_error")

    @app.exception_handler(UnsupportedSchemaVersionError)
    @app.exception_handler(DatabaseInitializationError)
    @app.exception_handler(RepositoryOperationError)
    @app.exception_handler(RepositoryError)
    async def repository_unavailable(
        _request: Request, _error_value: RepositoryError
    ) -> JSONResponse:
        return _error(503, "repository_unavailable")

    @app.exception_handler(Exception)
    async def internal_error(_request: Request, _error_value: Exception) -> JSONResponse:
        return _error(500, "internal_error")
