"""
SIMRS Batch Appointment Reminder — CALL-E REST API Integration

Processes a batch of hospital appointments and places CALL-E outbound calls
to remind each patient. Parses conversation outcomes and writes back to
SIMRS or SatuSehat FHIR endpoint.

This script uses only the Python standard library. No external dependencies.
Uses CALL-E REST API directly (api.heycall-e.com) — no OAuth/CLI needed.

Usage:
    export CALL_E_API_KEY="your-api-key"
    python3 client.py --appointments appointments.json
    python3 client.py --appointments appointments.json --dry-run
    python3 client.py --appointments appointments.json --simrs-url http://simrs.local/api
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CALL_E_API_BASE = "https://api.heycall-e.com"

CALL_TASK_TEMPLATE = (
    "You are an automated appointment reminder assistant for {hospital_name}. "
    "Call the patient at {phone_number} to remind them about their upcoming "
    "outpatient appointment. "
    "Appointment details: "
    "Doctor {doctor_name}, {department} department, "
    "{appointment_date} at {appointment_time}. "
    "Greet the patient warmly. "
    "Ask if they can attend: Can you make it? "
    "If they want to reschedule, ask for their preferred new time. "
    "If they cancel, acknowledge and note the reason. "
    "Do NOT provide any medical advice or discuss health conditions. "
    "Thank them at the end."
)

OUTCOME_PATTERNS = {
    "CONFIRMED": [
        r"\bconfirmed\b", r"\bcan attend\b", r"\bwill come\b",
        r"\byes\b.*\battend\b", r"\bthey will\b", r"\byes\b.*\bappointment\b",
    ],
    "RESCHEDULED": [
        r"\breschedule\b", r"\bnew time\b", r"\bdifferent time\b",
        r"\bchange.*time\b", r"\bprefer\b",
    ],
    "CANCELLED": [
        r"\bcancel\b", r"\bcannot attend\b", r"\bwon't come\b",
        r"\bnot coming\b", r"\bdecline\b",
    ],
    "PENDING_RETRY": [
        r"\bdid not connect\b", r"\bno answer\b", r"\bnot reachable\b",
        r"\bunavailable\b", r"\bbusy\b",
    ],
    "CONTACT_ERROR": [
        r"\binvalid.*number\b", r"\bwrong.*number\b",
        r"\bnot.*found\b", r"\bfailed.*connect\b",
    ],
}

MASKED_RE = re.compile(r"(\+\d{1,3})\d+(\d{4})")

# ---------------------------------------------------------------------------
# SSL Context
# ---------------------------------------------------------------------------

def get_ssl_context() -> ssl.SSLContext:
    """Return SSL context (compatible with container environments)."""
    ctx = ssl.create_default_context()
    try:
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
    except Exception:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ---------------------------------------------------------------------------
# API Client
# ---------------------------------------------------------------------------

class CalleClient:
    """Direct REST client for CALL-E API."""

    def __init__(self, api_key: str, base_url: str = CALL_E_API_BASE):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.ctx = get_ssl_context()

    def _request(self, method: str, path: str, data: dict | None = None) -> dict:
        """Make an authenticated API request."""
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = json.dumps(data).encode("utf-8") if data else None

        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
            return {"error": True, "status": e.code, "body": err_body}
        except Exception as e:
            return {"error": True, "message": str(e)}

    def health_check(self) -> bool:
        """Check if API is reachable."""
        try:
            url = f"{self.base_url}/health"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, context=self.ctx, timeout=10) as resp:
                return resp.status == 200
        except Exception:
            return False

    def create_call(self, task: str, metadata: dict | None = None) -> dict:
        """Create a new outbound call."""
        payload = {"task": task}
        if metadata:
            payload["metadata"] = metadata
        return self._request("POST", "/v1/calls", payload)

    def get_call(self, call_id: str) -> dict:
        """Get call status and transcript."""
        return self._request("GET", f"/v1/calls/{call_id}")

    def wait_for_call(self, call_id: str, timeout: int = 300, poll_interval: int = 15) -> dict:
        """Poll until call completes or times out."""
        elapsed = 0
        while elapsed < timeout:
            result = self.get_call(call_id)
            status = result.get("status", "")
            if status in ("completed", "failed"):
                return result
            time.sleep(poll_interval)
            elapsed += poll_interval
        return {"status": "timeout", "elapsed": elapsed}


# ---------------------------------------------------------------------------
# Appointment Loading
# ---------------------------------------------------------------------------

def load_appointments_json(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "appointments" in data:
        return data["appointments"]
    if isinstance(data, list):
        return data
    raise ValueError("JSON must be a list or {appointments: [...]}")

def load_appointments_csv(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def load_appointments(path: str) -> list[dict]:
    if path.endswith(".json"):
        return load_appointments_json(path)
    elif path.endswith(".csv"):
        return load_appointments_csv(path)
    raise ValueError(f"Unsupported format: {path}")

def validate_appointment(apt: dict) -> list[str]:
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
    return MASKED_RE.sub(r"\1****\2", phone)

def build_task(apt: dict) -> str:
    return CALL_TASK_TEMPLATE.format(
        hospital_name=apt.get("hospitalName", "Hospital"),
        phone_number=apt["phoneNumber"],
        doctor_name=apt.get("doctorName", "Doctor"),
        department=apt.get("department", "General"),
        appointment_date=apt.get("appointmentDate", ""),
        appointment_time=apt.get("appointmentTime", ""),
    )

def classify_outcome(result: dict) -> str:
    text = json.dumps(result).lower()
    for outcome, patterns in OUTCOME_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return outcome
    return "UNKNOWN"

def place_call(client: CalleClient, apt: dict, dry_run: bool = False,
               wait: bool = True, timeout: int = 300) -> dict:
    """Place a call for one appointment. Returns result dict."""
    phone = apt["phoneNumber"]
    task = build_task(apt)

    if dry_run:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "DRY_RUN",
            "task": task[:200] + "...",
        }

    # Create call
    metadata = {
        "appointmentId": apt["appointmentId"],
        "source": "simrs-batch-reminder",
    }
    resp = client.create_call(task, metadata)

    if resp.get("error"):
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "API_ERROR",
            "error": resp.get("body", resp.get("message", ""))[:200],
        }

    call_id = resp.get("id", "")
    if not wait:
        return {
            "appointmentId": apt["appointmentId"],
            "phone": mask_phone(phone),
            "status": "QUEUED",
            "callId": call_id,
        }

    # Wait for completion
    result = client.wait_for_call(call_id, timeout=timeout)

    # Parse outcome
    outcome = classify_outcome(result)
    summary = result.get("summary", "")

    # Extract transcript
    transcript = []
    recipients = result.get("recipients", [])
    if recipients:
        for att in recipients[0].get("attempts", []):
            for turn in att.get("transcript_turns", []):
                content = str(turn.get("content", "")).strip()
                if content:
                    transcript.append({
                        "role": turn.get("role", "?"),
                        "content": content,
                    })

    return {
        "appointmentId": apt["appointmentId"],
        "phone": mask_phone(phone),
        "status": outcome,
        "callId": call_id,
        "summary": summary,
        "transcript": transcript,
    }


# ---------------------------------------------------------------------------
# SIMRS Writeback
# ---------------------------------------------------------------------------

def writeback_simrs(base_url: str, results: list[dict]) -> None:
    ctx = get_ssl_context()
    for result in results:
        if result["status"] in ("DRY_RUN", "API_ERROR"):
            continue

        payload = json.dumps({
            "appointmentId": result["appointmentId"],
            "reminderStatus": result["status"],
            "callId": result.get("callId", ""),
            "summary": result.get("summary", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")

        url = f"{base_url.rstrip('/')}/appointments/{result['appointmentId']}/reminder"
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                result["writeback"] = "OK" if resp.status < 300 else f"HTTP {resp.status}"
        except Exception as e:
            result["writeback"] = f"ERROR: {e}"


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def generate_report(results: list[dict]) -> str:
    total = len(results)
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    lines = [
        "=" * 60,
        "  SIMRS Appointment Reminder — Batch Report",
        f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 60,
        "",
        f"  Total: {total}",
    ]
    for status, count in sorted(counts.items()):
        lines.append(f"  {status}: {count}")

    lines.append("")
    lines.append("-" * 60)
    lines.append(f"  {'ID':<22} {'Phone':<16} {'Status':<16} {'Summary'}")
    lines.append("-" * 60)

    for r in results:
        summary = r.get("summary", "")[:40]
        lines.append(
            f"  {r['appointmentId']:<22} {r['phone']:<16} {r['status']:<16} {summary}"
        )

    lines.append("=" * 60)

    # Show transcripts
    for r in results:
        transcript = r.get("transcript", [])
        if transcript:
            lines.append(f"\n  --- Transcript: {r['appointmentId']} ({r['phone']}) ---")
            for turn in transcript[:10]:
                lines.append(f"  [{turn['role']}] {turn['content'][:120]}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="SIMRS Batch Appointment Reminder via CALL-E REST API"
    )
    parser.add_argument("--appointments", required=True, help="JSON or CSV file")
    parser.add_argument("--dry-run", action="store_true", help="No real calls")
    parser.add_argument("--no-wait", action="store_true", help="Fire-and-forget (don't poll)")
    parser.add_argument("--simrs-url", help="SIMRS API for writeback")
    parser.add_argument("--delay", type=int, default=5, help="Seconds between calls")
    parser.add_argument("--timeout", type=int, default=300, help="Poll timeout per call")
    parser.add_argument("--api-key", help="CALL-E API key (or set CALL_E_API_KEY env)")
    parser.add_argument("--api-base", default=CALL_E_API_BASE, help="CALL-E API base URL")
    args = parser.parse_args()

    # Get API key
    api_key = args.api_key or os.environ.get("CALL_E_API_KEY", "")
    if not api_key and not args.dry_run:
        print("ERROR: Set CALL_E_API_KEY env or pass --api-key", file=sys.stderr)
        sys.exit(1)

    client = CalleClient(api_key, args.api_base)

    # Health check
    if not args.dry_run:
        print("Checking CALL-E API...")
        if not client.health_check():
            print("ERROR: CALL-E API not reachable", file=sys.stderr)
            sys.exit(1)
        print("API OK ✓")

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
        print(f"\n[{i+1}/{len(appointments)}] "
              f"{apt.get('patientName', '?')} ({mask_phone(apt['phoneNumber'])})...")

        result = place_call(
            client, apt,
            dry_run=args.dry_run,
            wait=not args.no_wait,
            timeout=args.timeout,
        )
        results.append(result)
        print(f"  → {result['status']}")

        if result.get("summary"):
            print(f"  → {result['summary'][:100]}")

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
