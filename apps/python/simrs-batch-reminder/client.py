"""
SIMRS Batch Appointment Reminder — CALL-E Integration

Processes a batch of hospital appointments and places CALL-E outbound calls
to remind each patient. Parses conversation outcomes and writes back to
SIMRS or SatuSehat FHIR endpoint.

This script uses only the Python standard library plus the CALL-E CLI.
No external dependencies required.

Usage:
    python3 client.py --appointments appointments.json
    python3 client.py --appointments appointments.json --dry-run
    python3 client.py --appointments appointments.csv --simrs-url http://simrs.local/api
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CLI_CANDIDATES = [
    ["node", "packages/cli/bin/calle.js"],
    ["calle"],
    ["npx", "-y", "@call-e/cli"],
]

CALL_GOAL_TEMPLATE = (
    "Anda adalah asisten pengingat janji temu otomatis dari {hospital_name}. "
    "Telepon pasien berikut untuk mengingatkan jadwal kontrol: "
    "Nama: {patient_name}. "
    "Dokter: {doctor_name} ({department}). "
    "Tanggal: {appointment_date} jam {appointment_time}. "
    "Tugas: 1) Sapa pasien dengan sopan. "
    "2) Sampaikan info janji temu. "
    "3) Tanya apakah bisa hadir. "
    "4) Jika reschedule, tanya waktu baru. "
    "5) Jika batal, tanya alasan. "
    "6) Akhiri dengan terima kasih. "
    "ATURAN: Berbicara Bahasa Indonesia. Jangan berikan saran medis. "
    "Jika pasien sebut kondisi darurat, sarankan hubungi 112."
)

OUTCOME_PATTERNS = {
    "CONFIRMED": [
        r"\bconfirmed\b", r"\bbisa hadir\b", r"\bakan datang\b",
        r"\bsetuju\b", r"\boke\b", r"\bsiap\b", r"\bya\b.*\bdatang\b",
    ],
    "RESCHEDULED": [
        r"\breschedule\b", r"\bdiganti\b", r"\bubah jadwal\b",
        r"\bminggu depan\b", r"\blain waktu\b",
    ],
    "CANCELLED": [
        r"\bcancel\b", r"\bbatal\b", r"\btidak bisa\b",
        r"\btidak jadi\b", r"\bsakit\b",
    ],
    "PENDING_RETRY": [
        r"\bno.?answer\b", r"\btidak diangkat\b", r"\btidak aktif\b",
        r"\bvoicemail\b", r"\bringing\b",
    ],
    "CONTACT_ERROR": [
        r"\binvalid.?number\b", r"\bnomor salah\b",
        r"\bnot.?found\b", r"\bwrong.?number\b",
    ],
}

MASKED_RE = re.compile(r"(\+\d{1,3})\d+(\d{4})")

# ---------------------------------------------------------------------------
# CLI Detection
# ---------------------------------------------------------------------------

def detect_cli(cwd: str) -> list[str]:
    """Return the first working calle CLI command."""
    for cmd in CLI_CANDIDATES:
        test = cmd + ["--help"]
        try:
            result = subprocess.run(
                test, capture_output=True, text=True, timeout=15, cwd=cwd
            )
            if result.returncode == 0:
                return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    print("ERROR: calle CLI not found. Install from https://github.com/CALLE-AI/call-e-integrations",
          file=sys.stderr)
    sys.exit(1)


def check_auth(cli: list[str], cwd: str) -> bool:
    """Check if CALL-E auth token is usable."""
    result = subprocess.run(
        cli + ["auth", "status", "--json"],
        capture_output=True, text=True, timeout=30, cwd=cwd
    )
    if result.returncode != 0:
        return False
    try:
        status = json.loads(result.stdout)
        return status.get("usable", False)
    except json.JSONDecodeError:
        return False


# ---------------------------------------------------------------------------
# Appointment Loading
# ---------------------------------------------------------------------------

def load_appointments_json(path: str) -> list[dict]:
    """Load appointments from a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "appointments" in data:
        return data["appointments"]
    if isinstance(data, list):
        return data
    raise ValueError("JSON must be a list of appointments or {appointments: [...]}")


def load_appointments_csv(path: str) -> list[dict]:
    """Load appointments from a CSV file."""
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def load_appointments(path: str) -> list[dict]:
    """Detect format and load appointments."""
    if path.endswith(".json"):
        return load_appointments_json(path)
    elif path.endswith(".csv"):
        return load_appointments_csv(path)
    else:
        raise ValueError(f"Unsupported file format: {path}")


def validate_appointment(apt: dict) -> list[str]:
    """Return list of missing required fields."""
    required = [
        "appointmentId", "patientName", "phoneNumber",
        "doctorName", "department", "appointmentDate",
        "appointmentTime", "hospitalName",
    ]
    return [f for f in required if not apt.get(f)]


# ---------------------------------------------------------------------------
# Call Execution
# ---------------------------------------------------------------------------

def mask_phone(phone: str) -> str:
    """Mask phone number for display."""
    return MASKED_RE.sub(r"\1****\2", phone)


def build_goal(apt: dict) -> str:
    """Build CALL-E call goal from appointment data."""
    return CALL_GOAL_TEMPLATE.format(
        hospital_name=apt.get("hospitalName", "Rumah Sakit"),
        patient_name=apt.get("patientName", "Pasien"),
        doctor_name=apt.get("doctorName", "Dokter"),
        department=apt.get("department", "Poli Umum"),
        appointment_date=apt.get("appointmentDate", ""),
        appointment_time=apt.get("appointmentTime", ""),
    )


def place_call(cli: list[str], apt: dict, cwd: str, dry_run: bool = False) -> dict:
    """Place a CALL-E call for one appointment. Returns result dict."""
    goal = build_goal(apt)
    phone = apt["phoneNumber"]
    timezone = apt.get("timezone", "Asia/Jakarta")

    if dry_run:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "DRY_RUN",
            "goal": goal[:200] + "...",
        }

    # Step 1: Plan
    plan_cmd = cli + [
        "call", "plan",
        "--to-phone", phone,
        "--goal", goal,
        "--language", "Indonesian",
        "--timezone", timezone,
    ]

    try:
        plan_result = subprocess.run(
            plan_cmd, capture_output=True, text=True, timeout=30, cwd=cwd
        )
    except subprocess.TimeoutExpired:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "PLAN_TIMEOUT",
        }

    if plan_result.returncode != 0:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "PLAN_FAILED",
            "error": plan_result.stderr[:200],
        }

    try:
        plan = json.loads(plan_result.stdout)
    except json.JSONDecodeError:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "PLAN_PARSE_ERROR",
        }

    if not plan.get("ready_to_run", False):
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "PLAN_NOT_READY",
            "question": plan.get("clarification_question", ""),
        }

    # Step 2: Run
    plan_id = plan.get("plan_id", "")
    confirm_token = plan.get("confirm_token", "")

    run_cmd = cli + [
        "call", "run",
        "--plan-id", plan_id,
        "--confirm-token", confirm_token,
    ]

    try:
        run_result = subprocess.run(
            run_cmd, capture_output=True, text=True, timeout=600, cwd=cwd
        )
    except subprocess.TimeoutExpired:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "CALL_TIMEOUT",
        }

    if run_result.returncode != 0:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "CALL_FAILED",
            "error": run_result.stderr[:200],
        }

    try:
        run_data = json.loads(run_result.stdout)
    except json.JSONDecodeError:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "CALL_PARSE_ERROR",
        }

    # Step 3: Parse outcome
    run_id = run_data.get("run_id", "")
    outcome = classify_outcome(run_data)

    return {
        "appointmentId": apt["appointmentId"],
        "phone": mask_phone(phone),
        "status": outcome,
        "runId": run_id,
        "rawResult": run_data,
    }


def classify_outcome(result: dict) -> str:
    """Classify call result into an outcome category."""
    text = json.dumps(result).lower()

    for outcome, patterns in OUTCOME_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return outcome

    return "UNKNOWN"


# ---------------------------------------------------------------------------
# SIMRS Writeback
# ---------------------------------------------------------------------------

def writeback_simrs(base_url: str, results: list[dict]) -> None:
    """Write call outcomes back to SIMRS REST API."""
    import urllib.request

    for result in results:
        if result["status"] in ("DRY_RUN", "PLAN_TIMEOUT", "PLAN_FAILED"):
            continue

        payload = json.dumps({
            "appointmentId": result["appointmentId"],
            "reminderStatus": result["status"],
            "callRunId": result.get("runId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")

        url = f"{base_url.rstrip('/')}/appointments/{result['appointmentId']}/reminder"
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                result["writeback"] = "OK" if resp.status < 300 else f"HTTP {resp.status}"
        except Exception as e:
            result["writeback"] = f"ERROR: {e}"


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def generate_report(results: list[dict]) -> str:
    """Generate a human-readable batch summary."""
    total = len(results)
    counts = {}
    for r in results:
        status = r["status"]
        counts[status] = counts.get(status, 0) + 1

    lines = [
        "=" * 60,
        f"  SIMRS Appointment Reminder — Batch Report",
        f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 60,
        "",
        f"  Total: {total}",
    ]

    for status, count in sorted(counts.items()):
        lines.append(f"  {status}: {count}")

    lines.append("")
    lines.append("-" * 60)
    lines.append(f"  {'ID':<20} {'Phone':<18} {'Status':<18} {'Writeback'}")
    lines.append("-" * 60)

    for r in results:
        wb = r.get("writeback", "-")
        lines.append(
            f"  {r['appointmentId']:<20} {r['phone']:<18} {r['status']:<18} {wb}"
        )

    lines.append("=" * 60)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="SIMRS Batch Appointment Reminder via CALL-E"
    )
    parser.add_argument(
        "--appointments", required=True,
        help="Path to appointments file (JSON or CSV)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Simulate calls without placing them"
    )
    parser.add_argument(
        "--simrs-url",
        help="SIMRS API base URL for writeback"
    )
    parser.add_argument(
        "--delay", type=int, default=5,
        help="Seconds between calls (default: 5)"
    )
    parser.add_argument(
        "--repo-root", default=".",
        help="Path to call-e-integrations repo root"
    )
    args = parser.parse_args()

    cwd = os.path.abspath(args.repo_root)

    # Detect CLI
    print("Detecting CALL-E CLI...")
    cli = detect_cli(cwd)
    print(f"Using: {' '.join(cli)}")

    # Check auth (skip for dry-run)
    if not args.dry_run:
        print("Checking CALL-E auth...")
        if not check_auth(cli, cwd):
            print("ERROR: CALL-E auth not usable. Run 'calle auth login' first.",
                  file=sys.stderr)
            sys.exit(1)
        print("Auth OK ✓")

    # Load appointments
    print(f"Loading appointments from {args.appointments}...")
    appointments = load_appointments(args.appointments)
    print(f"Found {len(appointments)} appointments")

    # Validate
    errors = []
    for i, apt in enumerate(appointments):
        missing = validate_appointment(apt)
        if missing:
            errors.append(f"  Row {i+1}: missing {', '.join(missing)}")

    if errors:
        print("Validation errors:", file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)
        sys.exit(1)

    # Process
    results = []
    for i, apt in enumerate(appointments):
        print(f"\n[{i+1}/{len(appointments)}] Calling {apt.get('patientName', '?')} "
              f"({mask_phone(apt['phoneNumber'])})...")

        result = place_call(cli, apt, cwd, dry_run=args.dry_run)
        results.append(result)
        print(f"  → {result['status']}")

        # Delay between calls
        if i < len(appointments) - 1 and not args.dry_run:
            time.sleep(args.delay)

    # Writeback
    if args.simrs_url and not args.dry_run:
        print("\nWriting results to SIMRS...")
        writeback_simrs(args.simrs_url, results)

    # Report
    report = generate_report(results)
    print(f"\n{report}")

    # Save results
    output_path = f"reminder-results-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to {output_path}")


if __name__ == "__main__":
    main()
