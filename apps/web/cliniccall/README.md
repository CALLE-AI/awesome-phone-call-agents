# ClinicCall

ClinicCall is an automated clinic appointment reminder and calling interface. It helps clinics manage patients, appointments, and appointment reminders from one dashboard.

## Features

* Patient management
* Appointment scheduling
* Appointment reminder call interface
* Call history
* Phone-number masking in the interface
* Credential-free demo mode
* React + Vite frontend
* Optional CALL-E integration for real outbound calls

## Project Structure

```text
cliniccall/
├── backend/
│   ├── database.py
│   ├── main.py
│   ├── models.py
│   ├── render.yaml
│   ├── requirements.txt
│   └── vercel.json
├── public/
├── src/
│   ├── App.jsx
│   ├── App.css
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
└── README.md
```

## Frontend

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Backend Demo Mode

ClinicCall includes a credential-free demo backend so the application can be tested without making real phone calls.

From the `backend` directory:

```bash
python -m venv venv
```

Activate the virtual environment and install dependencies:

```bash
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn main:app --reload
```

Demo mode is enabled by default:

```text
CLINICCALL_DEMO_MODE=true
```

In demo mode, starting a patient call simulates the call and records it in call history. No real phone call is placed and no CALL-E credentials are required.

### Demo workflow

1. Start the backend.
2. Start the frontend.
3. Add a patient.
4. Create an appointment.
5. Open the Call Center.
6. Select the patient.
7. Start the call.
8. The simulated call appears in call history.

## API Endpoints

The backend provides:

* `GET /` — API status
* `GET /patients` — list patients
* `POST /patients` — create a patient
* `GET /appointments` — list appointments
* `POST /appointments` — create an appointment
* `GET /call-history` — list call history
* `POST /call-patient` — start a simulated or real reminder call

## Real CALL-E Mode

ClinicCall also supports real outbound CALL-E calls.

To enable real calling:

```text
CLINICCALL_DEMO_MODE=false
```

and provide the required CALL-E API credentials through environment variables.

**Never commit API keys, tokens, passwords, or other secrets to the repository.**

Real calling depends on CALL-E supporting the destination phone number, language, region, and account configuration.

### Live CALL-E verification

The ClinicCall CALL-E integration has been successfully verified with a **live outbound demonstration call** using CALL-E's designated US testing hotline.

The verification confirmed that:

* the outbound call completed successfully;
* the ClinicCall agent introduced itself as an automated clinic appointment reminder;
* the recipient confirmed that they could hear the agent clearly;
* the agent completed the requested demonstration conversation and ended the call;
* CALL-E reported the call as `completed`;
* CALL-E reported the task as completed with high confidence.

The live test returned a **0.93 (high)** completion-confidence score and no failure code or failure message.

The US testing route was used because outbound calls to Kenya are currently restricted by CALL-E.

No API credentials are included in this repository.

## Privacy

Patient phone numbers are masked in the user interface and application logs.

Example:

```text
+2547•••••5678
```

The backend may store the phone number required to perform a call, but raw phone numbers should not be displayed unnecessarily in the UI or logs.

## Testing

Before submitting changes, build the frontend:

```bash
npm run build
```

For the demo backend, verify that the API starts successfully and that the demo call flow works without CALL-E credentials.

For real CALL-E testing, use valid CALL-E credentials supplied through environment variables and a destination supported by the CALL-E account.

The live CALL-E integration has been separately verified using CALL-E's designated US testing route.
### Reproducing the live CALL-E test

To reproduce the live integration test:

1. Set `CLINICCALL_DEMO_MODE=false`.
2. Provide a valid CALL-E API key through the `CALLE_API_KEY` environment variable.
3. Use CALL-E's designated US testing hotline as the destination.
4. Use the `US` region and `en-US` locale.
5. Start the outbound reminder call through the ClinicCall backend.

API credentials must be supplied by the tester and must not be committed to the repository.


