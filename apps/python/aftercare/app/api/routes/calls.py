from app.api.dependencies import (
    get_call_service,
    get_current_user,
    get_notification_service,
    get_patient_service,
)
from app.api.exceptions import (
    raise_http_from_doctor_alert_error,
    raise_http_from_patient_error,
    raise_http_from_trigger_error,
)
from app.models.orm import User
from app.models.schemas import (
    CallRead,
    CallTriggerRequest,
    DoctorAlertChannelRead,
    DoctorAlertRead,
    DoctorAlertRequest,
)
from app.services.call_service import CallService, TriggerError
from app.services.notification_service import DoctorAlertError, NotificationService
from app.services.patient_service import PatientService, PatientServiceError
from fastapi import APIRouter, Depends, status

router = APIRouter()


@router.post(
    "/trigger",
    response_model=CallRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def trigger_call(
    payload: CallTriggerRequest,
    _: User = Depends(get_current_user),
    service: CallService = Depends(get_call_service),
):
    try:
        return service.trigger(
            patient_id=payload.patient_id,
            followup_id=payload.followup_id,
            dry_run=payload.dry_run,
            authorized_destination=payload.authorized_destination,
        )
    except TriggerError as exc:
        raise_http_from_trigger_error(exc)


@router.post(
    "/{call_id}/alert-doctor",
    response_model=DoctorAlertRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def alert_doctor(
    call_id: int,
    payload: DoctorAlertRequest,
    _: User = Depends(get_current_user),
    call_service: CallService = Depends(get_call_service),
    patient_service: PatientService = Depends(get_patient_service),
    notifications: NotificationService = Depends(get_notification_service),
):
    try:
        call = call_service.get(call_id)
        patient = patient_service.get(call.patient_id)
        sms, warning = notifications.dispatch_emergency(
            patient=patient,
            call=call,
            dry_run=payload.dry_run,
            authorized_destination=payload.authorized_destination,
        )
    except TriggerError as exc:
        raise_http_from_trigger_error(exc)
    except PatientServiceError as exc:
        raise_http_from_patient_error(exc)
    except DoctorAlertError as exc:
        raise_http_from_doctor_alert_error(exc)
    return DoctorAlertRead(
        call_id=call.id,
        channels=[
            DoctorAlertChannelRead(
                channel=sms.channel,
                status=sms.status,
                attempt_count=sms.attempt_count,
            ),
            DoctorAlertChannelRead(
                channel=warning.channel,
                status=warning.status,
                attempt_count=warning.attempt_count,
            ),
        ],
    )


@router.get("", response_model=list[CallRead])
def list_calls(
    _: User = Depends(get_current_user),
    service: CallService = Depends(get_call_service),
):
    return service.list()


@router.get("/{call_id}", response_model=CallRead)
def get_call(
    call_id: int,
    _: User = Depends(get_current_user),
    service: CallService = Depends(get_call_service),
):
    try:
        return service.get(call_id)
    except TriggerError as exc:
        raise_http_from_trigger_error(exc)
