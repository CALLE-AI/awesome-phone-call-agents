# WAFE — Walk Me Home

> A conversational safety companion that stays with you while you walk and helps your trusted contact respond when something goes wrong.

## What is WAFE?

WAFE is a hackathon project for people who may have to walk alone, especially students, night-shift workers, delivery workers, and anyone traveling alone at night.

A user starts a **Walk Me Home** session. WAFE initiates a phone conversation, shares the user's latest known location, evaluates the outcome of the conversation, and creates a trusted-contact alert when the system detects a possible danger.

The voice/calling layer is powered by **CALL-E**, but CALL-E is an internal implementation detail. The user-facing product is WAFE.

## Why it matters

Most personal-safety tools require the user to actively press an SOS button, watch a screen, or use additional hardware. WAFE takes a different approach: **the conversation itself becomes part of the safety interface**.

For example:

```text
Normal conversation
        ↓
Possible distress
        ↓
Safety confirmation
        ↓
Danger detected
        ↓
Incident created
        ↓
Trusted contact alerted
```

A user can naturally say something like:

> "I think someone is following me."

The system can then move into a safety confirmation flow instead of requiring the user to navigate an app during a stressful moment.

## How it works

### 1. Start a Walk Me Home session

The user opens WAFE, enters their phone number, and selects **Start Walk Home**.

```text
User
  ↓
WAFE Web App
  ↓
FastAPI Backend
  ↓
CALL-E
  ↓
User's Phone
```

### 2. Natural conversation

CALL-E handles the live phone conversation using the Walk Me Home task. The conversation is intended to feel natural rather than repeatedly asking the user if they are safe.

The task pays attention to explicit distress signals such as:

- "I need help"
- "Someone is following me"
- "I'm scared"
- "I'm in danger"

When appropriate, the conversation can move into a confirmation step:

> "Are you in immediate danger?"

### 3. Structured safety result

After the call, WAFE receives structured information such as:

```json
{
  "safety_status": "danger",
  "distress_detected": "yes",
  "user_confirmed_danger": "yes",
  "reason": "User reported that someone was following them."
}
```

### 4. Safety Engine

WAFE has its own Safety Engine. CALL-E provides conversational evidence; the Safety Engine determines how that evidence affects the WAFE workflow.

Current states:

```text
SAFE
CONCERN
DANGER
UNKNOWN
```

The engine is intentionally conservative: unknown or incomplete information should not automatically become a danger event.

### 5. GPS context

The browser uses the Geolocation API to send the latest known position to the backend.

```text
Browser
   ↓
Geolocation API
   ↓
FastAPI
   ↓
SQLite
```

WAFE currently stores the latest known location per session.

### 6. Incident creation

When the Safety Engine detects danger, WAFE creates an incident containing the relevant safety context.

Example:

```text
Incident ID
Session ID
Call ID
Safety status
Reason
Distress detected
User confirmed danger
Timestamp
Last known location
```

### 7. Trusted-contact alert

The current MVP creates a trusted-contact alert in a dedicated dashboard.

```text
🚨 WAFE SAFETY ALERT

A Walk Me Home session detected a possible safety incident.

Reason:
User reported that someone was following them.

Last known location:
[Open Map]

Time:
10:42 PM

[ Acknowledge Alert ]
```

WAFE does not attempt to disguise or bypass the underlying calling provider's safety restrictions. The hackathon MVP uses a trusted-contact dashboard alert for escalation.

## Architecture

```text
                         ┌─────────────────────┐
                         │       USER          │
                         │                     │
                         │ WAFE Web App        │
                         └──────────┬──────────┘
                                    │
                           session + GPS
                                    ▼
                         ┌─────────────────────┐
                         │      FASTAPI        │
                         │      BACKEND        │
                         │                     │
                         │ Session Manager     │
                         │ Safety Engine       │
                         │ Incident Manager    │
                         │ Location Manager    │
                         └──────────┬──────────┘
                                    │
                              create call
                                    ▼
                         ┌─────────────────────┐
                         │       CALL-E        │
                         │                     │
                         │ Voice conversation  │
                         │ Structured result   │
                         │ Webhooks            │
                         └──────────┬──────────┘
                                    │
                             terminal webhook
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   SAFETY ENGINE     │
                         │                     │
                         │ SAFE                │
                         │ CONCERN             │
                         │ DANGER              │
                         │ UNKNOWN             │
                         └──────────┬──────────┘
                                    │
                              DANGER detected
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
             ┌─────────────────┐          ┌─────────────────┐
             │    INCIDENT     │          │      GPS        │
             │                 │          │                 │
             │ reason          │          │ last location   │
             │ session         │          │ coordinates     │
             │ timestamp       │          │ accuracy        │
             └────────┬────────┘          └────────┬────────┘
                      │                            │
                      └────────────┬───────────────┘
                                   ▼
                         ┌─────────────────────┐
                         │ TRUSTED CONTACT     │
                         │ DASHBOARD           │
                         │                     │
                         │ 🚨 Alert            │
                         │ 📍 Location         │
                         │ 🕒 Timestamp        │
                         │ ✅ Acknowledge      │
                         └─────────────────────┘
```

## File architecture

```text
Wafe/
│
├── backend/
│   │
│   ├── .env
│   ├── .env.example
│   ├── requirements.txt
│   │
│   ├── test_calle.py
│   ├── check_call.py
│   ├── test_safety.py
│   ├── test_incident.py
│   └── test_alert.py
│
│   └── app/
│       │
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       │
│       ├── api/
│       │   ├── __init__.py
│       │   ├── sessions.py
│       │   ├── session_status.py
│       │   ├── session_end.py
│       │   ├── webhooks.py
│       │   ├── location.py
│       │   ├── incidents.py
│       │   └── alerts.py
│       │
│       ├── calle/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   └── tasks.py
│       │
│       ├── safety/
│       │   ├── __init__.py
│       │   ├── models.py
│       │   ├── rules.py
│       │   └── engine.py
│       │
│       ├── database/
│       │   ├── __init__.py
│       │   └── database.py
│       │
│       ├── session/
│       │   ├── __init__.py
│       │   └── service.py
│       │
│       ├── location/
│       │   ├── __init__.py
│       │   └── service.py
│       │
│       ├── incidents/
│       │   ├── __init__.py
│       │   └── service.py
│       │
│       ├── alerts/
│       │   ├── __init__.py
│       │   └── service.py
│       │
│       └── static/
│           ├── user.html
│           ├── trusted_contact.html
│           ├── location_test.html
│           └── wafe-logo.png
│
├── frontend/
│   └── ...
│
├── data/
│   └── calle.db
│
├── .gitignore
├── README.md
└── docker-compose.yml
```

## Main backend components

### `app/main.py`
FastAPI entry point. Registers routes, initializes the database, and serves WAFE web pages/static assets.

### `app/api/`
HTTP endpoints for sessions, status, ending sessions, CALL-E webhooks, GPS, incidents, and alerts.

### `app/calle/`
CALL-E integration and the Walk Me Home conversation/task definition.

### `app/safety/`
The WAFE Safety Engine and its rules/models.

### `app/database/`
SQLite initialization and connection helpers.

### `app/session/`
Session creation and status management.

### `app/location/`
Latest GPS location storage and retrieval.

### `app/incidents/`
Safety incident creation.

### `app/alerts/`
Trusted-contact notification creation and acknowledgement.

### `app/static/`
The WAFE user interface, trusted-contact dashboard, development location page, and WAFE logo.

## Main API endpoints

```text
POST /api/session/start
GET  /api/session/status/{session_id}
POST /api/session/end/{session_id}

POST /api/location
GET  /api/location/{session_id}

POST /api/webhook/calle

GET  /api/incidents/{incident_id}

GET  /api/alerts
GET  /api/alerts/{alert_id}
POST /api/alerts/{alert_id}/acknowledge
```

## Technology stack

| Component | Technology |
|---|---|
| User interface | HTML, CSS, JavaScript |
| Backend | Python + FastAPI |
| Voice/calling | CALL-E |
| Database | SQLite |
| Location | Browser Geolocation API |
| Local tunnel | ngrok |
| Integration | REST + HTTPS webhooks |
| Safety output | JSON Schema / structured results |

## Example end-to-end scenario

```text
1. User opens WAFE.
2. User presses Start Walk Home.
3. Backend creates a session and CALL-E call task.
4. User answers the incoming phone call.
5. Normal conversation continues.
6. User says: "I think someone is following me."
7. The conversation asks for confirmation.
8. User confirms immediate danger.
9. CALL-E sends the terminal result to WAFE.
10. Safety Engine evaluates the result as DANGER.
11. WAFE creates an incident.
12. Latest GPS context is attached.
13. Trusted-contact dashboard shows the alert.
14. Trusted contact acknowledges the incident.
```

## MVP scope

Current MVP capabilities:

- Real phone-based conversational safety sessions
- CALL-E-powered conversation
- Structured safety results
- Safety state evaluation
- GPS tracking
- Incident creation
- Trusted-contact dashboard
- Alert acknowledgement
- Session management
- Mobile-friendly WAFE interface

## Future improvements

- SMS or push notifications
- Native Android/iOS app
- WebSockets for instant dashboard updates
- Unexpected call-disconnect handling
- Silence/anomaly detection during active sessions
- Route/deviation monitoring
- User-configurable safety phrases
- Authentication and secure user accounts
- Production-grade database
- Permanent HTTPS deployment

## Safety note

WAFE is a hackathon prototype, not a guaranteed emergency response system. Phone calls, networks, GPS, browsers, AI systems, and third-party services can fail or be delayed. In an actual emergency, users should contact local emergency services directly.

## Vision

> **Make walking alone feel less alone.**

WAFE puts the safety experience into a natural conversation so the user can keep their attention on getting home safely.
