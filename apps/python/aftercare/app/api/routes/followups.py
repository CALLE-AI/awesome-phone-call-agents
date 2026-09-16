from app.api.dependencies import get_current_user, get_followup_service
from app.api.exceptions import raise_http_from_followup_error
from app.models.orm import User
from app.models.schemas import FollowUpCreate, FollowUpRead
from app.services.followup_service import FollowUpService, FollowUpServiceError
from fastapi import APIRouter, Depends, status

router = APIRouter()


@router.post("", response_model=FollowUpRead, status_code=status.HTTP_201_CREATED)
def create_followup(
    payload: FollowUpCreate,
    _: User = Depends(get_current_user),
    service: FollowUpService = Depends(get_followup_service),
):
    try:
        return service.create(payload)
    except FollowUpServiceError as exc:
        raise_http_from_followup_error(exc)


@router.get("", response_model=list[FollowUpRead])
def list_followups(
    _: User = Depends(get_current_user),
    service: FollowUpService = Depends(get_followup_service),
):
    return service.list()
