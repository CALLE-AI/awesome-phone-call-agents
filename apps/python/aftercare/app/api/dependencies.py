import secrets

import jwt
from app.config import settings
from app.core.security import decode_access_token
from app.db import get_db
from app.models.orm import User
from app.repositories.agent_repository import AgentRepository
from app.repositories.call_repository import CallRepository
from app.repositories.dashboard_repository import DashboardRepository
from app.repositories.emergency_notification_repository import (
    EmergencyNotificationRepository,
)
from app.repositories.followup_repository import FollowUpRepository
from app.repositories.patient_repository import PatientRepository
from app.repositories.protocol_repository import ProtocolRepository
from app.repositories.symptom_repository import SymptomRepository
from app.repositories.user_repository import UserRepository
from app.repositories.webhook_event_repository import WebhookEventRepository
from app.services.agent_service import AgentService
from app.services.auth_service import AuthService, AuthServiceError
from app.services.call_service import CallService
from app.services.dashboard_service import DashboardService
from app.services.followup_service import FollowUpService
from app.services.notification_service import NotificationService
from app.services.patient_service import PatientService
from app.services.protocol_service import ProtocolService
from app.services.webhook_service import WebhookService
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

bearer_scheme = HTTPBearer(auto_error=False)
register_secret_header = APIKeyHeader(
    name="X-Register-Secret",
    auto_error=False,
    scheme_name="RegisterSecret",
)


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(UserRepository(db))


def require_register_secret(
    provided: str | None = Depends(register_secret_header),
) -> None:
    expected = settings.register_secret
    if not expected:
        if settings.is_deployed:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Registration is not configured",
            )
        return
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid register secret",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    service: AuthService = Depends(get_auth_service),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
        return service.get_active_user(user_id)
    except (jwt.PyJWTError, KeyError, ValueError, AuthServiceError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


def get_patient_service(db: Session = Depends(get_db)) -> PatientService:
    return PatientService(
        PatientRepository(db),
        ProtocolRepository(db),
        FollowUpRepository(db),
    )


def get_followup_service(db: Session = Depends(get_db)) -> FollowUpService:
    return FollowUpService(FollowUpRepository(db), PatientRepository(db))


def get_call_service(db: Session = Depends(get_db)) -> CallService:
    return CallService(
        PatientRepository(db),
        FollowUpRepository(db),
        CallRepository(db),
        ProtocolService(ProtocolRepository(db))
    )


def get_notification_service(db: Session = Depends(get_db)) -> NotificationService:
    return NotificationService(EmergencyNotificationRepository(db))


def get_webhook_service(db: Session = Depends(get_db)) -> WebhookService:
    return WebhookService(
        CallRepository(db),
        PatientRepository(db),
        SymptomRepository(db),
        ProtocolService(ProtocolRepository(db)),
        WebhookEventRepository(db),
        NotificationService(EmergencyNotificationRepository(db)),
    )


def get_protocol_service(db: Session = Depends(get_db)) -> ProtocolService:
    return ProtocolService(ProtocolRepository(db))


def get_dashboard_service(db: Session = Depends(get_db)) -> DashboardService:
    return DashboardService(DashboardRepository(db))


def get_agent_service(db: Session = Depends(get_db)) -> AgentService:
    return AgentService(AgentRepository(db))