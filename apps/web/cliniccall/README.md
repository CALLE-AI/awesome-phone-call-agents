# ClinicCall

ClinicCall is an AI-assisted clinic communication system for managing patients, appointments, and appointment reminder calls.

The project contains a React/Vite frontend and a FastAPI backend. The backend supports a credential-free demo mode so the complete application can be run and demonstrated without making a real phone call.

## Project structure

```text
cliniccall/
├── src/
│   ├── App.jsx
│   └── App.css
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   ├── requirements.txt
│   ├── render.yaml
│   └── vercel.json
├── package.json
└── README.md
```

## Features

* Patient management
* Appointment scheduling
* Clinic appointment call center
* Call history
* AI-assisted calling workflow
* Credential-free demo mode
* Phone-number masking in the user interface and backend logs

## Requirements

* Node.js 18+
* Python 3.10+
* npm
* pip

## Running the frontend

From this directory:

```bash
npm install
npm run dev
```

Vite will provide a local development URL, normally:

```text
http://localhost:5173
```

The frontend communicates with the deployed ClinicCall API by default.

## Running the backend locally

Open another terminal and enter the backend directory:

```bash
cd backend
```

Create and activate a virtual environment:

### Windows

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### macOS/Linux

```bash
python3 -m venv venv
source venv/bin/activate
```

Install the dependencies:

```bash
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn main:app --reload
```

The API will normally be available at:

```text
http://127.0.0.1:8000
```

The interactive API documentation is available at:

```text
http://127.0.0.1:8000/docs
```

## Demo mode

ClinicCall defaults to **demo mode**.

Demo mode does not require CALL-E credentials and does not place a real phone call. Instead, the backend simulates the calling workflow and records the call in the application's call history.

This makes the project runnable for development, review, and demonstration without requiring an external calling service.

The default setting is:

```text
CLINICCALL_DEMO_MODE=true
```

You can explicitly set it with:

### Windows PowerShell

```powershell
$env:CLINICCALL_DEMO_MODE="true"
```

### macOS/Linux

```bash
export CLINICCALL_DEMO_MODE=true
```

Then start the backend:

```bash
uvicorn main:app --reload
```

## Demo workflow

With the frontend and backend running:

1. Open ClinicCall in the browser.
2. Add a patient.
3. Create an appointment for that patient.
4. Open **Call Center** or use **Call patient** from an appointment.
5. Select the appointment.
6. Start the patient call.
7. In demo mode, ClinicCall simulates the call instead of contacting a real phone number.
8. The simulated call appears in **Call History**.

This provides a complete runnable path for demonstrating the application's calling workflow without external calling credentials.

## API endpoints

The backend provides the following main endpoints:

| Endpoint        | Method | Purpose                           |
| --------------- | ------ | --------------------------------- |
| `/`             | GET    | API health/status                 |
| `/patients`     | GET    | List patients                     |
| `/patients`     | POST   | Create a patient                  |
| `/appointments` | GET    | List appointments                 |
| `/appointments` | POST   | Create an appointment             |
| `/call-history` | GET    | View call history                 |
| `/call-patient` | POST   | Start a patient call or demo call |

## Real CALL-E mode

The backend also contains the integration path for CALL-E.

Real calling requires the appropriate CALL-E credentials and configuration supplied through environment variables. Credentials should **never** be committed to this repository.

For development and review, demo mode is recommended:

```text
CLINICCALL_DEMO_MODE=true
```

When real calling is disabled, ClinicCall remains fully demonstrable through the simulated calling workflow.

## Phone-number privacy

Phone numbers are required when creating patients because they are part of the calling workflow.

However, real phone numbers are not displayed in the patient lists or appointment selectors. The frontend masks phone numbers before displaying them, for example:

```text
+2547•••••5678
```

The backend also masks phone numbers in API responses and application logs where appropriate.

The phone number entered into the patient form is still submitted to the backend because it is required for the calling workflow.

## Development

Build the frontend for production with:

```bash
npm run build
```

Preview the production build with:

```bash
npm run preview
```

The backend can be run in development with:

```bash
uvicorn main:app --reload
```

## Notes

ClinicCall is intended as a hackathon/demo application. Demo mode is the recommended way to evaluate the complete application without relying on external phone-call availability or credentials.
