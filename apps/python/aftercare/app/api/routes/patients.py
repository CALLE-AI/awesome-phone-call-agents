from app.api.dependencies import get_current_user, get_patient_service
from app.api.exceptions import raise_http_from_patient_error
from app.models.orm import User
from app.models.schemas import PatientCreate, PatientRead
from app.services.patient_service import PatientService, PatientServiceError
from fastapi import APIRouter, Depends, status

router = APIRouter()


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
def create_patient(
    payload: PatientCreate,
    _: User = Depends(get_current_user),
    service: PatientService = Depends(get_patient_service),
):
    try:
        return service.create(payload)
    except PatientServiceError as exc:
        raise_http_from_patient_error(exc)


@router.get("", response_model=list[PatientRead])
def list_patients(
    _: User = Depends(get_current_user),
    service: PatientService = Depends(get_patient_service),
):
    return service.list()


@router.get("/{patient_id}", response_model=PatientRead)
def get_patient(
    patient_id: int,
    _: User = Depends(get_current_user),
    service: PatientService = Depends(get_patient_service),
):
    try:
        return service.get(patient_id)
    except PatientServiceError as exc:
        raise_http_from_patient_error(exc)

