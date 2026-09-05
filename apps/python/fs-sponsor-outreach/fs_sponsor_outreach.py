#!/usr/bin/env python3
"""
fs_sponsor_outreach.py

Batch outbound sponsor-outreach caller built on CALL-E, for student
racing teams (Formula Student, FSAE, etc.) reaching out to prospective
sponsors from a CSV lead list.

Wraps the `calle` CLI directly (`calle call start` / `calle call status`) -
no AI agent required. Requires the `calle` CLI installed and authenticated:

    npm install -g @call-e/cli
    calle auth login

Usage:
    python3 fs_sponsor_outreach.py leads.csv --team-name "Formula Student XYZ" --out results.csv
    python3 fs_sponsor_outreach.py leads.csv --team-name "..." --dry-run

CSV columns required: name, phone (E.164, e.g. +15550101234), region
Optional columns: notes

Safety note: only call numbers of people who have consented to be
called by this workflow. Do not add real, un-contacted third parties
to the leads CSV.
"""

import argparse
import csv
import json
import subprocess
import sys
import time
from pathlib import Path

TERMINAL_STATUSES = {"COMPLETED", "NO ANSWER", "DECLINED", "FAILED"}


def run_calle(args):
    """Run a calle CLI command and return parsed JSON stdout."""
    result = subprocess.run(["calle"] + args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"calle command failed: {' '.join(args)}\n{result.stderr}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"calle did not return JSON for: {' '.join(args)}\n{result.stdout}")


def build_goal(team_name, contact_name, notes):
    goal = (
        f"Call {contact_name} and briefly introduce {team_name}, a university "
        f"Formula Student racing team looking for sponsorship. Ask whether they'd "
        f"be interested in hearing more. If yes, ask for the best way and time to "
        f"follow up. If not interested, thank them politely and end the call."
    )
    if notes:
        goal += f" Context: {notes}."
    return goal


def place_call(team_name, lead):
    goal = build_goal(team_name, lead["name"], lead.get("notes", ""))
    args = ["call", "start", "--to-phone", lead["phone"], "--goal", goal]
    if lead.get("region"):
        args += ["--region", lead["region"]]
    return run_calle(args)


def poll_status(run_id, poll_interval=3, max_wait=180):
    waited = 0
    status = run_calle(["call", "status", "--run-id", run_id])
    while status.get("status") not in TERMINAL_STATUSES and waited < max_wait:
        time.sleep(poll_interval)
        waited += poll_interval
        status = run_calle(["call", "status", "--run-id", run_id])
    return status


def extract_result(status):
    result = status.get("result", {}) or {}
    extracted = result.get("extracted", {}) or {}
    return {
        "status": status.get("status"),
        "summary": result.get("summary"),
        "interest_level": extracted.get("interest_level"),
        "best_contact_method": extracted.get("best_contact_method"),
        "best_contact_time": extracted.get("best_contact_time"),
        "notes": extracted.get("notes"),
    }


def main():
    parser = argparse.ArgumentParser(description="Batch sponsor-outreach caller using CALL-E.")
    parser.add_argument("leads_csv", help="CSV file with columns: name, phone, region, notes")
    parser.add_argument("--team-name", required=True, help="Name of the team pitched on the call")
    parser.add_argument("--out", default="results.csv", help="Output CSV path for structured results")
    parser.add_argument("--dry-run", action="store_true", help="Print planned goals without calling")
    args = parser.parse_args()

    leads_path = Path(args.leads_csv)
    if not leads_path.exists():
        sys.exit(f"Leads file not found: {leads_path}")

    with leads_path.open(newline="", encoding="utf-8") as f:
        leads = list(csv.DictReader(f))

    if not leads:
        sys.exit("No leads found in CSV.")

    rows_out = []
    for lead in leads:
        name = (lead.get("name") or "").strip()
        phone = (lead.get("phone") or "").strip()
        if not name or not phone:
            print(f"Skipping incomplete row: {lead}")
            continue

        goal = build_goal(args.team_name, name, lead.get("notes", ""))

        if args.dry_run:
            print(f"[DRY RUN] {name} <{phone}> region={lead.get('region', '-')}\n  goal: {goal}\n")
            continue

        print(f"Calling {name} <{phone}>...")
        started = place_call(args.team_name, lead)
        run_id = started.get("run_id")
        if not run_id:
            print(f"  Failed to start call: {started}")
            rows_out.append({"name": name, "phone": phone, "status": "START_FAILED"})
            continue

        final_status = poll_status(run_id)
        row = extract_result(final_status)
        row.update({"name": name, "phone": phone, "run_id": run_id})
        rows_out.append(row)
        print(f"  -> {row['status']} | interest: {row.get('interest_level')}")

    if args.dry_run:
        return

    fieldnames = [
        "name", "phone", "run_id", "status", "interest_level",
        "best_contact_method", "best_contact_time", "notes", "summary",
    ]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows_out:
            writer.writerow({k: row.get(k, "") for k in fieldnames})

    print(f"\nDone. Results written to {args.out}")


if __name__ == "__main__":
    main()
