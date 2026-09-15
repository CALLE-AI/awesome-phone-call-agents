import os
import re
import secrets
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
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

# Real-call destinations must be explicitly allowlisted.
# Store comma-separated ASCII E.164 numbers in:
# CLINICCALL_ALLOWED_DESTINATIONS=+254700000001,+254700000002
_raw_allowed_destinations = os.getenv(
    "CLINICCALL_ALLOWED_DESTINATIONS",
    "",
)
ALLOWED_DESTINATIONS = {
    value.strip()
    for value in _raw_allowed_destinations.split(",")
    if value.strip()
}

# Demo mode is SAFE by default.
# Real outbound calls require explicitly setting:
# CLINICCALL_DEMO_MODE=false
DEMO_MODE = os.getenv(
    "CLINICCALL_DEMO_MODE",
    "true",
).strip().lower() != "false"


# ============================================================
# OPERATOR AUTHENTICATION
# ============================================================

OPERATOR_USERNAME = os.getenv(
    "CLINICCALL_OPERATOR_USERNAME",
    "demo",
)

OPERATOR_PASSWORD = os.getenv(
    "CLINICCALL_OPERATOR_PASSWORD",
    "demo-password",
)

security = HTTPBasic()


def require_operator(
    credentials: HTTPBasicCredentials = Depends(security),
):
    correct_username = secrets.compare_digest(
        credentials.username,
        OPERATOR_USERNAME,
    )

    correct_password = secrets.compare_digest(
        credentials.password,
        OPERATOR_PASSWORD,
    )

    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Basic"},
        )

    return credentials.username


# ============================================================
# CALL-E CLIENT
# ============================================================

calle_client = None

if CALLE_API_KEY and not DEMO_MODE:
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

    # The operator must explicitly confirm that
    # the destination is authorized for this call.
    destination_authorized: bool = False


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "message": "ClinicCall AI API is running",
        "status": "online",
        "demo_mode": DEMO_MODE,
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy",
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


# ============================================================
# STRICT ASCII E.164 VALIDATION
# ============================================================

E164_PATTERN = re.compile(
    r"^\+[1-9][0-9]{7,14}$"
)


def validate_phone_number(phone: str) -> bool:

    return E164_PATTERN.fullmatch(phone) is not None


# ============================================================
# PHONE MASKING
# ============================================================

def mask_phone_number(phone: str) -> str:

    if not phone:
        return "••••"

    if len(phone) <= 8:
        return "••••"

    return f"{phone[:4]}•••••{phone[-4:]}"


# ============================================================
# SAFE MODEL SERIALIZATION
# ============================================================

def model_to_dict(model):

    if hasattr(model, "model_dump"):
        return model.model_dump()

    if hasattr(model, "dict"):
        return model.dict()

    return dict(model)


def safe_patient_response(patient):

    data = model_to_dict(patient)

    if "phone_number" in data:
        data["phone_number"] = mask_phone_number(
            data["phone_number"]
        )

    return data


def safe_call_history_response(call):

    data = model_to_dict(call)

    if "phone_number" in data:
        data["phone_number"] = mask_phone_number(
            data["phone_number"]
        )

    return data


# ============================================================
# PATIENTS
# ============================================================

@app.get("/patients")
def get_patients(
    session: Session = Depends(get_session),
    operator: str = Depends(require_operator),
):

    patients = session.exec(
        select(Patient)
    ).all()

    return [
        safe_patient_response(patient)
        for patient in patients
    ]


@app.post("/patients")
def create_patient(
    patient_data: PatientCreate,
    session: Session = Depends(get_session),
    operator: str = Depends(require_operator),
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
                "Use a valid number such as "
                "+254769710722."
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
        f"Phone: "
        f"{mask_phone_number(patient.phone_number)}"
    )
    print("")

    return safe_patient_response(patient)


# ============================================================
# APPOINTMENTS
# ============================================================

@app.get("/appointments")
def get_appointments(
    session: Session = Depends(get_session),
    operator: str = Depends(require_operator),
):

    appointments = session.exec(
        select(Appointment)
    ).all()

    return appointments


@app.post("/appointments")
def create_appointment(
    appointment_data: AppointmentCreate,
    session: Session = Depends(get_session),
    operator: str = Depends(require_operator),
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
    operator: str = Depends(require_operator),
):

    calls = session.exec(
        select(CallHistory)
    ).all()

    return [
        safe_call_history_response(call)
        for call in calls
    ]


# ============================================================
# CALL PATIENT
# ============================================================

@app.post("/call-patient")
def call_patient(
    request: CallPatientRequest,
    session: Session = Depends(get_session),
    operator: str = Depends(require_operator),
):

    # --------------------------------------------------------
    # EXPLICIT DESTINATION AUTHORIZATION
    # --------------------------------------------------------

    if not request.destination_authorized:

        raise HTTPException(
            status_code=403,
            detail="Destination authorization is required.",
        )

    print("")
    print("========================================")
    print("CALL-PATIENT REQUEST RECEIVED")
    print("========================================")
    print(f"Patient ID: {request.patient_id}")
    print("Destination authorization: CONFIRMED")
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

    print("----------------------------------------")
    print("PATIENT FOUND")
    print(f"Name: {patient.name}")
    print(
        f"Phone: "
        f"{mask_phone_number(patient.phone_number)}"
    )
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

    print("PHONE CHECK")
    print(
        f"Normalized phone: "
        f"{mask_phone_number(phone_number)}"
    )
    print("----------------------------------------")


    # --------------------------------------------------------
    # VALIDATE PHONE
    # --------------------------------------------------------

    if not validate_phone_number(phone_number):

        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid E.164 phone number. "
                "Use a valid number such as "
                "+254769710722."
            ),
        )

    # For real outbound calls, the destination must be explicitly
    # allowlisted. This prevents an operator from turning an arbitrary
    # patient number into an outbound provider destination.
    if not DEMO_MODE and phone_number not in ALLOWED_DESTINATIONS:
        raise HTTPException(
            status_code=403,
            detail="Destination is not authorized for outbound calling.",
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
        print(
            f"Phone: "
            f"{mask_phone_number(phone_number)}"
        )
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
            "phone_number": mask_phone_number(
                phone_number
            ),
            "appointment_id": appointment.id,
            "status": "demo_completed",
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
            detail="CALL-E is not configured.",
        )


    # --------------------------------------------------------
    # REAL CALL-E CALL
    # --------------------------------------------------------

    print("")
    print("========================================")
    print("STARTING REAL CALL-E CALL")
    print("========================================")
    print(f"Patient: {patient.name}")
    print(
        f"Phone: "
        f"{mask_phone_number(phone_number)}"
    )
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


        # ----------------------------------------------------
        # DO NOT LOG RAW PROVIDER RESPONSE
        # ----------------------------------------------------

        print("")
        print("========================================")
        print("CALL-E RESULT RECEIVED")
        print("========================================")
        print("CALL-E response received successfully.")
        print("========================================")
        print("")


        # ----------------------------------------------------
        # GET STATUS
        # ----------------------------------------------------

        call_status = "completed"

        if isinstance(result, dict):

            call_status = str(
                result.get(
                    "status",
                    "completed",
                )
            )


        # ----------------------------------------------------
        # UPDATE CALL HISTORY
        # ----------------------------------------------------

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


        # ----------------------------------------------------
        # SAFE SUCCESS RESPONSE
        # ----------------------------------------------------

        return {
            "success": True,
            "mode": "real",
            "message": "CALL-E call completed.",
            "patient_id": patient.id,
            "patient_name": patient.name,
            "phone_number": mask_phone_number(
                phone_number
            ),
            "appointment_id": appointment.id,
            "status": call_status,
        }


    except Exception:

        print("")
        print("========================================")
        print("CALL-E CALL ERROR")
        print("========================================")
        print("CALL-E call failed.")
        print("========================================")
        print("")


        # ----------------------------------------------------
        # SAVE FAILURE
        # ----------------------------------------------------

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
                type(database_error).__name__,
            )


        # ----------------------------------------------------
        # RETURN SAFE ERROR
        # ----------------------------------------------------

        raise HTTPException(
            status_code=500,
            detail="CALL-E call failed. Please try again.",
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
            and not DEMO_MODE
        ),
        "demo_mode": DEMO_MODE,
    }