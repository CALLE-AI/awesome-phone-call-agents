# Clinic Appointment Concierge

A CALL-E-powered runnable app that calls a clinic on behalf of a patient to schedule an appointment, negotiates a different time if the preferred slot is unavailable, and returns a structured result.

## Problem

Booking a clinic appointment often means being put on hold, calling back multiple times, or waiting for office hours. This app automates the phone call itself: it dials the clinic, states the patient's request, and if the first-choice time isn't available, it can retry at a different time or ask the user to confirm a retry — all without the patient having to make the call.

## Who it's for

Anyone who needs to book a routine clinic appointment (check-up, follow-up, prescription renewal visit) but can't easily make the call themselves during clinic hours — for example, patients managing multiple ongoing treatments, caregivers booking on behalf of a family member, or busy patients who'd rather have the call handled automatically.

## Safety model

This app is built so it cannot place an unintended or unauthorized call:

- **Dry-run by default.** Running the script without `--live` never places a call — it only prints what would happen.
- **Explicit live confirmation.** `--live` mode asks for interactive `y/N` confirmation before dialing, unless `--yes` is also passed.
- **Authorized-recipient allow-list.** Even in `--live` mode, the destination number must be listed in the `ALLOWED_RECIPIENTS` environment variable (comma-separated E.164 numbers). If it isn't, the script refuses to call.
- **Strict E.164 validation.** Phone numbers that don't match strict E.164 format are rejected before anything else runs.
- **Phone masking.** Phone numbers are masked in all console output (e.g. `+12***42`), never printed in full.
- **No shell interpolation.** All calls to the CALL-E CLI use argument-array process execution (`execFile`), so user-supplied input can never be interpreted as shell syntax.
- **No silent success.** Failed, timed-out, or unrecognized outcomes are surfaced explicitly and the script exits with a non-zero status rather than assuming success.
- **No raw transcript dumping.** Output is a structured, length-capped summary — not a raw provider transcript.

## How it works

The app uses the real CALL-E CLI contract in sequence:

1. **`calle call plan --to-phone <clinic-number> --goal <text>`** — builds a call plan. The patient's name, reason for visit, and preferred time are combined into the `--goal` text. This returns a `plan_id` and a `confirm_token`.
2. **`calle call run --plan-id <plan_id> --confirm-token <confirm_token>`** — executes the planned call. Both the plan ID and the confirmation token returned by `plan` are required to run the call.
3. **`calle call status --run-id <run_id>`** — polls for the call's status and result. If the call fails to connect or the requested time isn't available, the script surfaces a retry decision and prompts the user interactively (retry now, or stop). A failed, timed-out, or declined-retry outcome exits with a non-zero status.

## Setup

```bash
git clone <this-repo-url>
cd apps/typescript/clinic-appointment-concierge
npm install
```

Install and authenticate the CALL-E CLI separately, per CALL-E's own documentation, so the `calle` command is on your `PATH`.

## Usage

### Dry run (default, no call placed)

```bash
node appointment-concierge.js \
  --phone "+15555550100" \
  --patient "Jordan Example" \
  --preferred "tomorrow afternoon" \
  --reason "check-up"
```

### Live call

```bash
export ALLOWED_RECIPIENTS="+15555550100"

node appointment-concierge.js \
  --phone "+15555550100" \
  --patient "Jordan Example" \
  --preferred "tomorrow afternoon" \
  --reason "check-up" \
  --live
```

You'll be asked to confirm before the call is placed. Pass `--yes` to skip the interactive prompt in non-interactive environments (the `ALLOWED_RECIPIENTS` gate still applies).

**Arguments:**

| Flag | Description |
|---|---|
| `--phone` | Clinic phone number to call (strict E.164 format) |
| `--patient` | Patient name to give to the clinic |
| `--preferred` | Preferred appointment time (natural language) |
| `--reason` | Reason for the visit |
| `--live` | Actually place the call (default: dry run only) |
| `--yes` | Skip the interactive live-call confirmation prompt |

## Note on testing

The example numbers in this README (`+15555550100`) use the reserved `555-0100`–`555-0199` range, which is fictional and never assigned to a real subscriber. For your own testing, use an official reserved test number appropriate to your region and add it to `ALLOWED_RECIPIENTS` before running with `--live`.

## License

MIT