# Clinic Appointment Concierge

A CALL-E-powered workflow plugin that calls a clinic on behalf of a patient to schedule an appointment, negotiates a different time if the preferred slot is unavailable, and returns a structured result.

## Problem

Booking a clinic appointment often means being put on hold, calling back multiple times, or waiting for office hours. This plugin automates the phone call itself: it dials the clinic, states the patient's request, and if the first-choice time isn't available, it can retry at a different time or ask the user to confirm a retry — all without the patient having to make the call.

## Who it's for

Anyone who needs to book a routine clinic appointment (check-up, follow-up, prescription renewal visit) but can't easily make the call themselves during clinic hours — for example, patients managing multiple ongoing treatments, caregivers booking on behalf of a family member, or busy patients who'd rather have the call handled automatically.

## How it works

The plugin uses three CALL-E MCP tools in sequence:

1. **`plan_call`** — builds a call plan with the clinic's phone number, the patient's name, the reason for the visit, and the preferred appointment time.
2. **`run_call`** — executes the planned call.
3. **`get_call_run`** — polls for the call's status and result. If the call fails to connect or the requested time isn't available, the response includes a `next_step` with an `ask_user_for_retry_confirmation` action, letting the user choose to retry immediately, retry later, or provide a different time.

All call results are returned as structured JSON (`run_id`, `status`, `plan_id`, `next_step`, etc.), so the plugin can be chained into other workflows.

## Setup

1. Install the CALL-E CLI:
```bash
   npm install -g @call-e/cli
```
2. Authenticate with CALL-E:
```bash
   calle auth login
```
3. Clone this repository and install dependencies:
```bash
   git clone <this-repo-url>
   cd clinic-appointment-concierge
   npm install
```

## Usage

```bash
node appointment-concierge.js \
  --phone "+12125550142" \
  --patient "Jane Doe" \
  --preferred "tomorrow afternoon" \
  --reason "check-up"
```

**Arguments:**

| Flag | Description |
|---|---|
| `--phone` | Clinic phone number to call (E.164 format) |
| `--patient` | Patient name to give to the clinic |
| `--preferred` | Preferred appointment time (natural language) |
| `--reason` | Reason for the visit |

The script runs the full `plan_call → run_call → get_call_run` flow and prints the structured result, including any retry instructions if the call didn't succeed.

## Note on testing

CALL-E currently supports calling recipients in a defined set of regions (US, SG, MY, IN, AE, AU, CA, GB, VN, DE, JP, FR, MX, BR, ID, PH, KE). For testing and demo purposes, this plugin was validated against official North American reserved test numbers (`+1<area-code>5550100`–`+1<area-code>5550199`), which are guaranteed not to reach a real person. This allows the full technical flow to be verified end-to-end without placing unwanted calls.

## Contact

iancuileana83@gmail.com