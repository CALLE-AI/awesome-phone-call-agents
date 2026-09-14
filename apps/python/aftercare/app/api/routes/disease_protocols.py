from app.api.dependencies import get_current_user, get_protocol_service
from app.api.exceptions import raise_http_from_protocol_error
from app.models.orm import User
from app.models.schemas import (
    DiseaseProtocolCreate,
    DiseaseProtocolDetail,
    DiseaseProtocolListItem,
    DiseaseProtocolUpdate,
)
from app.services.protocol_service import ProtocolService, ProtocolServiceError
from fastapi import APIRouter, Depends, status

router = APIRouter()


@router.get("", response_model=list[DiseaseProtocolListItem])
def list_protocols(
    _: User = Depends(get_current_user),
    service: ProtocolService = Depends(get_protocol_service),
):
    return service.list_active()


@router.post(
    "",
    response_model=DiseaseProtocolDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_protocol(
    payload: DiseaseProtocolCreate,
    _: User = Depends(get_current_user),
    service: ProtocolService = Depends(get_protocol_service),
):
    try:
        return service.create(payload)
    except ProtocolServiceError as exc:
        raise_http_from_protocol_error(exc)


@router.get("/{protocol_id}", response_model=DiseaseProtocolDetail)
def get_protocol(
    protocol_id: int,
    _: User = Depends(get_current_user),
    service: ProtocolService = Depends(get_protocol_service),
):
    try:
        return service.get_detail_response(protocol_id)
    except ProtocolServiceError as exc:
        raise_http_from_protocol_error(exc)


@router.put("/{protocol_id}", response_model=DiseaseProtocolDetail)
def update_protocol(
    protocol_id: int,
    payload: DiseaseProtocolUpdate,
    _: User = Depends(get_current_user),
    service: ProtocolService = Depends(get_protocol_service),
):
    try:
        return service.update(protocol_id, payload)
    except ProtocolServiceError as exc:
        raise_http_from_protocol_error(exc)
