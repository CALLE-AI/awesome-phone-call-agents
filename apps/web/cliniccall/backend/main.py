
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session, create_tables
from models import Patient, Appointment, CallHistory
from calle import CalleClient


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

CALLE_API_KEY = (
    os.getenv("CALLE_API_KEY")
    or os.getenv("CALL_E_API_KEY")
)

# Demo mode is ON by default.
# This allows the repository to run locally without CALL-E
# credentials and without placing real phone calls.
DEMO_MODE = os.getenv(
    "CLINICCALL_DEMO_MODE",
    "true",
).lower() == "true"


if CALLE_API_KEY:
    print("CALL-E API key detected.")
else:
    print("CALL-E API key is NOT configured. Demo mode is available.")


# ============================================================
# CALL-E CLIENT
# ============================================================

calle_client = None

if CALLE_API_KEY:
    calle_client = CalleClient(
        api_key=CALLE_API_KEY
    )


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="ClinicCall AI",
    description="AI-powered clinic patient calling system",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# STARTUP
# ============================================================

@app.on_event("startup")
def startup():

    if not os.getenv("VERCEL"):
        create_tables()

    print("")
    print("========================================")
    print("ClinicCall AI API started")
    print("========================================")

    if CALLE_API_KEY:
        print("CALL-E: CONFIGURED")
    else:
        print("CALL-E: NOT CONFIGURED")

    print(
        f"DEMO MODE: "
        f"{'ENABLED' if DEMO_MODE else 'DISABLED'}"
    )

    print("========================================")


# ============================================================
# REQUEST MODELS
# ============================================================

class PatientCreate(BaseModel):
    name: str
    phone_number: str


class AppointmentCreate(BaseModel):
    patient_id: int
    appointment_date: str
    appointment_time: str
    clinic_name: str = "ClinicCall Demo Clinic"


class CallPatientRequest(BaseModel):
    patient_id: int


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "message": "ClinicCall AI API is running",
        "status": "online",
        "cale_configured": CALLE_API_KEY is not None,
        "demo_mode": DEMO_MODE,
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy",
        "cale_configured": CALLE_API_KEY is not None,
        "demo_mode": DEMO_MODE,
    }


# ============================================================
# PHONE NORMALIZATION
# ============================================================

def normalize_phone_number(phone: str) -> str:

    phone = str(phone).strip()

    phone = (
        phone
        .replace(" ", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
    )

    if phone.startswith("00"):
        phone = "+" + phone[2:]

    elif phone.startswith("0"):
        phone = "+254" + phone[1:]

    elif phone.startswith("254"):
        phone = "+" + phone

    return phone


def mask_phone_number(phone: str) -> str:
    """
    Return a safe display version of a phone number.

    Example:
    +254769710722 -> +254•••••0722
    """

    phone = str(phone)

    if len(phone) <= 4:
        return "••••"

    return phone[:4] + "•••••" + phone[-4:]


def validate_phone_number(phone: str) -> bool:

    if not phone.startswith("+"):
        return False

    digits = phone[1:]

    if not digits.isdigit():
        return False

    if len(digits) < 8 or len(digits) > 15:
        return False

    return True


# ============================================================
# PATIENTS
# ============================================================

@app.get("/patients")
def get_patients(
    session: Session = Depends(get_session),
):

    patients = session.exec(
        select(Patient)
    ).all()

    return [
        {
            "id": patient.id,
            "name": patient.name,
            "phone_number": mask_phone_number(
                patient.phone_number
            ),
        }
        for patient in patients
    ]


@app.post("/patients")
def create_patient(
    patient_data: PatientCreate,
    session: Session = Depends(get_session),
):

    name = patient_data.name.strip()

    phone = normalize_phone_number(
        patient_data.phone_number
    )

    if not name:
        raise HTTPException(
            status_code=422,
            detail="Patient name is required.",
        )

    if not validate_phone_number(phone):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid phone number. "
                "Use a valid E.164 phone number."
            ),
        )

    patient = Patient(
        name=name,
        phone_number=phone,
    )

    session.add(patient)
    session.commit()
    session.refresh(patient)

    print("")
    print("PATIENT CREATED")
    print(f"ID: {patient.id}")
    print(f"Name: {patient.name}")
    print(
        f"Phone: {mask_phone_number(patient.phone_number)}"
    )
    print("")

    return {
        "id": patient.id,
        "name": patient.name,
        "phone_number": mask_phone_number(
            patient.phone_number
        ),
    }


# ============================================================
# APPOINTMENTS
# ============================================================

@app.get("/appointments")
def get_appointments(
    session: Session = Depends(get_session),
):

    appointments = session.exec(
        select(Appointment)
    ).all()

    return appointments


@app.post("/appointments")
def create_appointment(
    appointment_data: AppointmentCreate,
    session: Session = Depends(get_session),
):

    patient = session.get(
        Patient,
        appointment_data.patient_id,
    )

    if patient is None:
        raise HTTPException(
            status_code=404,
            detail="Patient not found.",
        )

    appointment = Appointment(
        patient_id=appointment_data.patient_id,
        appointment_date=appointment_data.appointment_date,
        appointment_time=appointment_data.appointment_time,
        clinic_name=appointment_data.clinic_name,
        status="pending",
    )

    session.add(appointment)
    session.commit()
    session.refresh(appointment)

    print("")
    print("APPOINTMENT CREATED")
    print(f"Appointment ID: {appointment.id}")
    print(f"Patient: {patient.name}")
    print(f"Date: {appointment.appointment_date}")
    print(f"Time: {appointment.appointment_time}")
    print("")

    return appointment


# ============================================================
# CALL HISTORY
# ============================================================

@app.get("/call-history")
def get_call_history(
    session: Session = Depends(get_session),
):

    calls = session.exec(
        select(CallHistory)
    ).all()

    return [
        {
            "id": call.id,
            "appointment_id": call.appointment_id,
            "phone_number": mask_phone_number(
                call.phone_number
            ),
            "call_status": call.call_status,
            "appointment_status": call.appointment_status,
        }
        for call in calls
    ]


# ============================================================
# CALL PATIENT
# ============================================================

@app.post("/call-patient")
def call_patient(
    request: CallPatientRequest,
    session: Session = Depends(get_session),
):

    print("")
    print("========================================")
    print("CALL-PATIENT REQUEST RECEIVED")
    print("========================================")
    print(f"Patient ID: {request.patient_id}")
    print("")

    # --------------------------------------------------------
    # FIND PATIENT
    # --------------------------------------------------------

    patient = session.get(
        Patient,
        request.patient_id,
    )

    if patient is None:
        raise HTTPException(
            status_code=404,
            detail="Patient not found.",
        )

    masked_phone = mask_phone_number(
        patient.phone_number
    )

    print("----------------------------------------")
    print("PATIENT FOUND")
    print(f"Name: {patient.name}")
    print(f"Phone: {masked_phone}")
    print("----------------------------------------")

    # --------------------------------------------------------
    # FIND APPOINTMENT
    # --------------------------------------------------------

    appointments = session.exec(
        select(Appointment)
        .where(
            Appointment.patient_id == patient.id
        )
    ).all()

    if not appointments:
        raise HTTPException(
            status_code=404,
            detail=(
                "This patient does not have an appointment. "
                "Create an appointment before calling."
            ),
        )

    appointment = appointments[-1]

    print("APPOINTMENT FOUND")
    print(f"Appointment ID: {appointment.id}")
    print(f"Date: {appointment.appointment_date}")
    print(f"Time: {appointment.appointment_time}")
    print(f"Clinic: {appointment.clinic_name}")
    print("----------------------------------------")

    # --------------------------------------------------------
    # NORMALIZE PHONE
    # --------------------------------------------------------

    phone_number = normalize_phone_number(
        patient.phone_number
    )

    masked_phone = mask_phone_number(
        phone_number
    )

    print("PHONE CHECK")
    print(f"Normalized phone: {masked_phone}")
    print("----------------------------------------")

    if not validate_phone_number(phone_number):

        raise HTTPException(
            status_code=422,
            detail="Invalid E.164 phone number.",
        )

    # --------------------------------------------------------
    # AI TASK
    # --------------------------------------------------------

    task = f"""
You are ClinicCall AI, an automated clinic
appointment assistant.

Call the patient at the provided phone number.

You are calling {patient.name} on behalf of
{appointment.clinic_name}.

This is an appointment reminder call.

Patient name:
{patient.name}

Clinic:
{appointment.clinic_name}

Appointment date:
{appointment.appointment_date}

Appointment time:
{appointment.appointment_time}

Your job is to:

1. Greet the patient politely.
2. Introduce yourself as ClinicCall AI.
3. Tell the patient you are calling from
   {appointment.clinic_name}.
4. Remind them about their appointment.
5. Tell the patient the appointment date is
   {appointment.appointment_date}.
6. Tell the patient the appointment time is
   {appointment.appointment_time}.
7. Ask if they can confirm the appointment.
8. If they confirm, thank them.
9. If they cannot attend, politely tell them
   they should contact the clinic to reschedule.
10. End the call politely.

Speak in English.

Do not provide medical advice.

Do not ask for sensitive medical information.

Keep the call short, friendly and professional.
"""

    # --------------------------------------------------------
    # CREATE CALL HISTORY
    # --------------------------------------------------------

    call_history = CallHistory(
        appointment_id=appointment.id,
        phone_number=phone_number,
        call_status="calling",
        appointment_status=appointment.status or "pending",
    )

    session.add(call_history)
    session.commit()
    session.refresh(call_history)

    # --------------------------------------------------------
    # DEMO MODE
    # --------------------------------------------------------

    if DEMO_MODE:

        print("")
        print("========================================")
        print("CLINICCALL DEMO MODE")
        print("========================================")
        print("No real phone call will be placed.")
        print(f"Patient: {patient.name}")
        print(f"Phone: {masked_phone}")
        print(f"Appointment: {appointment.id}")
        print("")

        call_history.call_status = "demo_completed"
        call_history.appointment_status = "completed"

        appointment.status = "completed"

        session.add(call_history)
        session.add(appointment)

        session.commit()
        session.refresh(call_history)

        print("DEMO CALL COMPLETED")
        print("========================================")
        print("")

        return {
            "success": True,
            "mode": "demo",
            "message": (
                "ClinicCall demo call workflow completed. "
                "No real phone call was placed."
            ),
            "patient_id": patient.id,
            "patient_name": patient.name,
            "phone_number": masked_phone,
            "appointment_id": appointment.id,
            "status": "demo_completed",
            "call_result": {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {
                    "score": 1.0,
                    "label": "high",
                },
                "evidence": [
                    "Demo workflow successfully processed "
                    "the patient's appointment reminder."
                ],
                "structured_result": {
                    "appointment_reminder_processed": "yes"
                },
            },
        }

    # --------------------------------------------------------
    # CHECK CALL-E
    # --------------------------------------------------------

    if not CALLE_API_KEY or calle_client is None:

        call_history.call_status = "failed"

        session.add(call_history)
        session.commit()

        raise HTTPException(
            status_code=500,
            detail=(
                "CALL-E is not configured. "
                "Enable demo mode for local testing or "
                "configure CALL-E credentials for real calls."
            ),
        )

    # --------------------------------------------------------
    # REAL CALL-E CALL
    # --------------------------------------------------------

    print("")
    print("========================================")
    print("STARTING REAL CALL-E CALL")
    print("========================================")
    print(f"Patient: {patient.name}")
    print(f"Phone: {masked_phone}")
    print(f"Appointment: {appointment.id}")
    print("Region: KE")
    print("Locale: en-US")
    print("")
    print("Sending request to CALL-E...")
    print("========================================")
    print("")

    try:

        result = calle_client.calls.create_and_wait(
            task=task,
            recipients=[
                {
                    "phones": [phone_number],
                    "region": "KE",
                    "locale": "en-US",
                }
            ],
        )

        print("")
        print("========================================")
        print("CALL-E RESULT RECEIVED")
        print("========================================")
        print("CALL-E response received.")
        print("========================================")
        print("")

        call_status = "completed"

        if isinstance(result, dict):
            call_status = str(
                result.get(
                    "status",
                    "completed",
                )
            )

        call_history.call_status = call_status

        if call_status == "completed":
            appointment.status = "completed"

        call_history.appointment_status = (
            appointment.status
        )

        session.add(call_history)
        session.add(appointment)

        session.commit()
        session.refresh(call_history)

        return {
            "success": True,
            "mode": "real",
            "message": "CALL-E call completed.",
            "patient_id": patient.id,
            "patient_name": patient.name,
            "phone_number": masked_phone,
            "appointment_id": appointment.id,
            "status": call_status,
            "call_result": result,
        }

    except Exception as error:

        error_message = str(error)

        print("")
        print("========================================")
        print("CALL-E CALL ERROR")
        print("========================================")
        print("CALL-E call failed.")
        print("========================================")
        print("")

        try:

            call_history.call_status = "failed"

            call_history.appointment_status = (
                appointment.status
            )

            session.add(call_history)
            session.commit()

        except Exception as database_error:

            session.rollback()

            print(
                "Could not save call failure:",
                str(database_error),
            )

        raise HTTPException(
            status_code=500,
            detail=f"CALL-E call failed: {error_message}",
        )


# ============================================================
# DEMO
# ============================================================

@app.get("/demo")
def demo():

    return {
        "project": "ClinicCall AI",
        "description": (
            "AI-powered automated patient "
            "calling system"
        ),
        "real_calls_enabled": (
            CALLE_API_KEY is not None
        ),
        "demo_mode": DEMO_MODE,
        "message": (
            "Demo mode uses a simulated call and "
            "does not place a real phone call."
        ),
    }

