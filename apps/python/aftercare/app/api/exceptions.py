from app.services.auth_service import AuthServiceError
from app.services.call_service import TriggerError
from app.services.followup_service import FollowUpServiceError
from app.services.notification_service import DoctorAlertError
from app.services.patient_service import PatientServiceError
from app.services.protocol_service import ProtocolServiceError
from app.services.webhook_service import WebhookServiceError
from fastapi import HTTPException, status


def raise_http_from_auth_error(exc: AuthServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def raise_http_from_trigger_error(exc: TriggerError) -> None:
    detail = str(exc)
    code = status.HTTP_400_BAD_REQUEST
    if "not found" in detail.lower():
        code = status.HTTP_404_NOT_FOUND
    elif "consent" in detail.lower():
        code = status.HTTP_403_FORBIDDEN
    raise HTTPException(status_code=code, detail=detail) from exc


def raise_http_from_doctor_alert_error(exc: DoctorAlertError) -> None:
    detail = str(exc)
    code = status.HTTP_400_BAD_REQUEST
    if "not found" in detail.lower():
        code = status.HTTP_404_NOT_FOUND
    raise HTTPException(status_code=code, detail=detail) from exc


def raise_http_from_patient_error(exc: PatientServiceError) -> None:
    detail = str(exc)
    code = (
        status.HTTP_404_NOT_FOUND
        if "not found" in detail.lower()
        else status.HTTP_422_UNPROCESSABLE_ENTITY
    )
    raise HTTPException(status_code=code, detail=detail) from exc


def raise_http_from_followup_error(exc: FollowUpServiceError) -> None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def raise_http_from_webhook_error(exc: WebhookServiceError) -> None:
    code = getattr(exc, "status_code", status.HTTP_404_NOT_FOUND)
    raise HTTPException(status_code=code, detail=str(exc)) from exc

def raise_http_from_protocol_error(exc: ProtocolServiceError) -> None:
    detail = str(exc)
    lower = detail.lower()
    if "not found" in lower:
        code = status.HTTP_404_NOT_FOUND
    elif "already exists" in lower:
        code = status.HTTP_409_CONFLICT
    else:
        code = status.HTTP_400_BAD_REQUEST
    raise HTTPException(status_code=code, detail=detail) from exc