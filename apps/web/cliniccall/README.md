ClinicCall AI

ClinicCall AI is a web-based clinic phone-call application that helps clinics manage patients, appointments, and AI-assisted phone calls from one place.

It combines a patient and appointment dashboard with CALL-E phone-call functionality, allowing clinic staff to initiate calls to patients and keep track of call activity.

What it does

ClinicCall provides a simple workflow for clinic staff:

1. View and manage patients.
2. Create and manage appointments.
3. Initiate an AI-assisted phone call to a patient.
4. Monitor call results.
5. Review call history.

The goal is to reduce repetitive administrative phone work while keeping clinic staff in control of when calls are initiated.

Architecture

ClinicCall consists of two parts:

- Web frontend: React + Vite
- Backend: Python + FastAPI

The frontend provides the clinic dashboard and communicates with the FastAPI backend.

The backend manages patients, appointments, and CALL-E API requests.

Clinic staff
     │
     ▼
ClinicCall Web App
     │
     ▼
FastAPI Backend
     │
     ▼
CALL-E
     │
     ▼
Patient phone

Live demo

The functional demo is available at:

https://cliniccall-olive.vercel.app/

The backend API is deployed at:

https://cliniccall-api.onrender.com/

Setup

Frontend

The frontend requires Node.js and npm.

cd cliniccall-frontend
npm install
npm run dev

The development server will normally be available at:

http://localhost:5173

Backend

The backend requires Python.

cd CLINICCALL-AI
python -m venv venv

Activate the virtual environment on Windows:

.\venv\Scripts\Activate.ps1

Install the dependencies:

pip install -r requirements.txt

Start the FastAPI server:

uvicorn main:app --reload

Credentials

CALL-E credentials must be supplied through environment variables.

Do not put real API keys in source code, request files, Git commits, or this repository.

Example:

CALLAIAPIKEY=<your-call-e-api-key>

The actual value must be kept private.

Usage

Start the backend and frontend, then open the ClinicCall web interface.

From the dashboard, a clinic user can:

- View patients.
- Add patients.
- View appointments.
- Create appointments.
- Initiate a patient call.
- Review call history.

Phone calls should only be initiated when the clinic user intentionally requests the action.

Phone-call side effects

A CALL-E request can result in an actual phone call being placed.

This is the primary external side effect of the application.

Before using the live calling functionality:

- Use phone numbers that you are authorized to contact.
- Keep the CALL-E API key private.
- Confirm that the patient is an appropriate recipient for the call.
- Do not use the application to provide medical diagnosis or emergency assistance.

The application does not automatically place recurring calls.

Preview and testing

The frontend can be tested locally without deploying the application.

The backend API can also be run locally using FastAPI/Uvicorn.

For development and testing, use test data and authorized phone numbers.

A developer should verify the patient and appointment workflow before enabling live phone calls.

Cancellation and recovery

If a call has already been accepted by CALL-E, the application cannot assume that the call was cancelled simply because the frontend request ended.

Call results should therefore be checked through the backend/CALL-E response rather than treating a failed browser request as proof that no call occurred.

If a call fails, the application reports the failure instead of representing it as a successful completed call.

Safety

ClinicCall is an administrative phone-call application.

It should not be used to:

- Provide medical diagnosis.
- Provide emergency instructions.
- Collect payment-card information.
- Request passwords or authentication secrets from patients.
- Make decisions about a patient's medical treatment.

Emergency situations should be directed to the appropriate local emergency services.

Project status

ClinicCall is a functional demonstration application built to demonstrate a practical CALL-E phone-call workflow for healthcare administration.

It is a demo and is not a replacement for a clinical information system or emergency service.

Contribution

This project is contributed to the CALL-E Awesome Phone Call Agents repository as a User-facing App under:

apps/web/cliniccall/

It demonstrates a browser-based application that can be used to manage clinic phone-call workflows.