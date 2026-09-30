import logging

from app.core.datetimes import utc_now_naive
from app.integrations.calle import CalleCreateUnknownError, place_call
from app.models.orm import Call
from app.repositories.call_repository import CallRepository
from app.repositories.followup_repository import FollowUpRepository
from app.repositories.patient_repository import PatientRepository
from app.services.protocol_service import ProtocolService
from app.utils.validators import destinations_match, is_supported_e164

logger = logging.getLogger(__name__)


class TriggerError(Exception):
    """Domain error while triggering a follow-up call."""


class CallService:
    def __init__(
        self,
        patients: PatientRepository,
        followups: FollowUpRepository,
        calls: CallRepository,
        protocols: ProtocolService,
    ):
        self.patients = patients
        self.followups = followups
        self.calls = calls
        self.protocols = protocols

    def trigger(
        self,
        *,
        patient_id: int,
        followup_id: int | None = None,
        dry_run: bool = True,
        authorized_destination: str | None = None,
    ) -> Call:
        patient = self.patients.get_by_id(patient_id)
        if not patient:
            raise TriggerError("Patient not found")

        followup = None
        if followup_id is not None:
            followup = self.followups.get_for_patient(followup_id, patient.id)
            if not followup:
                raise TriggerError("Follow-up not found for this patient")

        if not patient.consent_on_file and not dry_run:
            raise TriggerError("Patient has not provided consent")

        if not dry_run:
            if not authorized_destination:
                raise TriggerError(
                    "Live calls require authorized_destination set to the exact patient phone"
                )
            if not is_supported_e164(authorized_destination):
                raise TriggerError(
                    "authorized_destination must be a supported ASCII E.164 number"
                )
            if not destinations_match(authorized_destination, patient.phone):
                raise TriggerError(
                    "authorized_destination does not match the patient phone"
                )

        try:
            protocol = self.protocols.get_for_patient(patient)
            task = self.protocols.build_task(patient, protocol)
            result_schema = self.protocols.build_result_schema(protocol)
        except Exception as exc:
            raise TriggerError(str(exc)) from exc

        call = Call(
            patient_id=patient.id,
            followup_id=followup.id if followup else None,
            status="queued",
            dry_run=dry_run,
            call_start=utc_now_naive(),
        )
        call = self.calls.create(call)

        try:
            result = place_call(
                patient=patient,
                followup=followup,
                task=task,
                result_schema=result_schema,
                protocol=protocol,
                dry_run=dry_run,
                internal_call_id=call.id,
            )
        except CalleCreateUnknownError:
            call.status = "outcome_unknown"
            logger.warning(
                "Ambiguous CALL-E create for call id=%s followup=%s; not retrying",
                call.id,
                followup.id if followup else None,
            )
            return self.calls.save(call)
        except Exception as exc:
            call.status = "failed"
            self.calls.save(call)
            raise TriggerError(str(exc)) from exc

        call.calle_call_id = result.provider_call_id
        call.status = result.status
        call.dry_run = result.dry_run
        return self.calls.save(call)

    def list(self) -> list[Call]:
        return self.calls.list_all()

    def get(self, call_id: int) -> Call:
        call = self.calls.get_by_id(call_id)
        if not call:
            raise TriggerError("call not found")
        return call

    def process_due_followups(self, *, dry_run: bool = True) -> None:
        if not dry_run:
            logger.warning(
                "Scheduler cannot place live calls; forcing dry_run=true"
            )
        dry_run = True
        now = utc_now_naive()
        due = self.followups.get_due(now, limit=20)

        if not due:
            logger.info("No due follow-ups to trigger")
            return

        logger.info("Found %s due follow-up(s) to trigger", len(due))
        for followup in due:
            followup.status = "in_progress"
            followup.attempt_count += 1
            self.followups.save(followup)

            try:
                call = self.trigger(
                    patient_id=followup.patient_id,
                    followup_id=followup.id,
                    dry_run=dry_run,
                )
                if call.status == "outcome_unknown":
                    logger.warning(
                        "Ambiguous provider create for followup=%s patient=%s call=%s; leaving in_progress",
                        followup.id,
                        followup.patient_id,
                        call.id,
                    )
                    continue
                followup.status = "completed"
                self.followups.save(followup)
                logger.info(
                    "Triggered call id=%s followup=%s patient=%s status=%s dry_run=%s",
                    call.id,
                    followup.id,
                    followup.patient_id,
                    call.status,
                    dry_run,
                )
            except TriggerError as exc:
                logger.warning(
                    "Failed to trigger followup=%s patient=%s: %s",
                    followup.id,
                    followup.patient_id,
                    exc,
                )
                if followup.attempt_count >= followup.max_attempts:
                    followup.status = "failed"
                else:
                    followup.status = "pending"
                self.followups.save(followup)
