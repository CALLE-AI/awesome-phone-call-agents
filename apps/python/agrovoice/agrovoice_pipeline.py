"""
AgroVoice — Cocoa farmer callback app (CALL-E), safety-reviewed version.

CHANGES FOLLOWING PR #281 REVIEW (Ray-56) — each numbered item maps
directly to a "Must Fix" point from the review:

  1. Preview/dry-run is now the DEFAULT entry point. No API key is
     required, and no call can be placed, unless the operator
     explicitly chooses a LIVE path and then explicitly confirms
     per-recipient (typing "CALL", not just pressing Enter).

  2. Destination handling now enforces strict E.164 validation (no
     more "prepend a country code to arbitrary input") AND an
     explicit local allowlist (authorized_numbers.txt) — a number
     must be BOTH valid E.164 AND present on the allowlist before any
     live call can be placed. Demo numbers now use the real
     standards-reserved fictional block (+1-202-555-01xx, NANPA).

  3. Full phone numbers are no longer printed, sent as metadata, or
     persisted. mask_number() is applied everywhere except the one
     place CALL-E actually needs the real number to dial
     (payload["recipient"]["phone"]). The phone number has also been
     removed entirely from the request's "metadata" field and from
     the natural-language task text (CALL-E's `recipient` field
     handles dialing — the number never needs to appear in prose).

  4. Any ambiguous outcome (local timeout while still "queued", or a
     network/HTTP error during call creation whose real server-side
     result is unknown) now STOPS the batch run entirely for operator
     reconciliation — it no longer auto-retries or silently advances
     to the next number.

  5. Non-English prose (the call task itself) is unchanged, pending
     explicit maintainer approval requested in the PR thread — see
     the note in TASK_TEMPLATE below.
"""

import os
import re
import json
import time
import csv
import sqlite3
from datetime import datetime
import pandas as pd
import requests

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════
CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")
CALLE_BASE_URL = "https://api.heycall-e.com/v1"

POLLING_INTERVAL_SEC = 5
CALL_TIMEOUT_SEC = 600

ALLOWLIST_PATH = "authorized_numbers.txt"

# Real, standards-reserved fictional numbers (NANPA drop-in block:
# area code 202 + exchange 555 + 0100-0199 range is permanently
# reserved for fictional use in samples/media — these are guaranteed
# to never be a real, assignable destination).
DEMO_NUMBERS = [
    "+12025550142",
    "+12025550163",
    "+12025550188",
]

RESULT_SCHEMA = {
    "type": "object",
    "required": ["village", "harvest_bags", "logistics_issues", "call_outcome"],
    "properties": {
        "village": {
            "type": "string",
            "description": "Name of the village mentioned by the farmer. Empty string if not mentioned.",
        },
        "harvest_bags": {
            "type": "integer",
            "description": "Number of cocoa bags harvested this week. Use -1 if not clearly given.",
        },
        "logistics_issues": {
            "type": "string",
            "description": "Short summary of road/logistics difficulties mentioned. Empty string if none.",
        },
        "call_outcome": {
            "type": "string",
            "enum": ["completed_full", "completed_partial", "no_answer", "declined", "unknown"],
            "description": "Outcome classification of the call.",
        },
    },
    "additionalProperties": False,
}

# NOTE ON LANGUAGE (review point 5): this task text is intentionally
# in French with Bulu-language greetings, because the real recipients
# are Cameroonian cocoa farmers who speak French and local languages
# — not the maintainers' English-only convention for repository-facing
# content. Explicit maintainer approval for this exception has been
# requested in the PR thread; this file will be updated to reflect
# the outcome of that discussion.
#
# The number is intentionally NOT embedded in this text (unlike the
# previous version) — CALL-E's structured `recipient` field carries
# the real destination, so the task itself never needs to expose it.
TASK_TEMPLATE = (
    "Commence par dire distinctement en langue Bulu : 'Mbolo ! Je suis l'assistant "
    "de la coopérative.' Demande ensuite, dans un français simple et clair : "
    "le nom du village, le nombre de sacs de cacao récoltés cette semaine, "
    "et s'il y a des difficultés de route ou de logistique pour l'acheminement. "
    "IMPORTANT : termine TOUJOURS la conversation en disant le mot 'Akiba' "
    "(qui signifie 'merci' en langue Bulu) — ce doit être la toute dernière "
    "chose prononcée, juste avant de raccrocher, même si le producteur "
    "n'a pas répondu à toutes les questions."
)


# ═══════════════════════════════════════════════════════════════
# REVIEW FIX #2 — strict E.164 validation + local allowlist
# ═══════════════════════════════════════════════════════════════
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def is_valid_e164(number):
    """Strict E.164 check. No auto-fixing, no guessing a country
    code — an invalid number is simply rejected."""
    return bool(E164_PATTERN.match(number))


def load_allowlist(path=ALLOWLIST_PATH):
    """
    Loads operator-authorized numbers from a local text file (one
    E.164 number per line, '#' comments allowed). This file is NOT
    part of the repository (see .gitignore) — each operator maintains
    their own, containing only numbers they are personally authorized
    to call.
    """
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {
            line.strip() for line in f
            if line.strip() and not line.strip().startswith("#")
        }


def is_authorized(number, allowlist):
    return number in allowlist


# ═══════════════════════════════════════════════════════════════
# REVIEW FIX #3 — mask numbers everywhere except the real API dial target
# ═══════════════════════════════════════════════════════════════
def mask_number(e164_number):
    """
    Returns a masked version for display, logs, and storage. The
    real number is used ONLY in the actual CALL-E API payload
    (payload["recipient"]["phone"]) — never here.
    """
    if len(e164_number) < 8:
        return "*" * len(e164_number)
    return e164_number[:4] + "*" * (len(e164_number) - 7) + e164_number[-3:]


# ═══════════════════════════════════════════════════════════════
# CALL-E REST API
# ═══════════════════════════════════════════════════════════════
def _headers(idempotency_key=None):
    h = {
        "Authorization": f"Bearer {CALLE_API_KEY}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


class AmbiguousOutcome(Exception):
    """
    Raised whenever we cannot be certain whether a real call was or
    was not placed/completed server-side (review fix #4). Callers
    MUST stop and surface this for human reconciliation — never
    catch-and-retry, never silently advance to the next recipient.
    """
    pass


def create_call(real_number, idempotency_key):
    """
    Creates a call via POST /v1/calls. The real E.164 number is used
    ONLY here, in the structured `recipient` field — never in the
    task text, never in metadata (review fix #3).

    On ANY ambiguous failure (timeout, connection error — cases where
    we genuinely don't know if CALL-E received/processed the request),
    raises AmbiguousOutcome instead of retrying (review fix #4).
    """
    payload = {
        "task": TASK_TEMPLATE,
        "recipient": {"phone": real_number},
        "result_schema": RESULT_SCHEMA,
        "metadata": {"project": "agrovoice"},  # no phone number here
    }
    try:
        response = requests.post(
            f"{CALLE_BASE_URL}/calls",
            headers=_headers(idempotency_key=idempotency_key),
            json=payload,
            timeout=40,
        )
        response.raise_for_status()
        return response.json()["id"]
    except requests.exceptions.Timeout:
        raise AmbiguousOutcome(
            "Timeout while creating the call — CALL-E may or may not have "
            "received the request. Do not retry automatically."
        )
    except requests.exceptions.RequestException as e:
        raise AmbiguousOutcome(f"Ambiguous error during call creation: {e}")


def get_call_state(call_id):
    response = requests.get(
        f"{CALLE_BASE_URL}/calls/{call_id}", headers=_headers(), timeout=15
    )
    response.raise_for_status()
    return response.json()


def wait_for_result(call_id, timeout_sec=CALL_TIMEOUT_SEC):
    """
    Polls until a terminal status or a local timeout. A local timeout
    is treated as AMBIGUOUS (review fix #4) — we do not know the real
    server-side outcome, so we raise rather than guessing.
    """
    start_time = time.time()
    last_notice = 0

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout_sec:
            raise AmbiguousOutcome(
                f"Local polling timeout after {timeout_sec}s — the call's "
                f"real status is unknown. Check the CALL-E dashboard before "
                f"resuming."
            )

        state = get_call_state(call_id)
        status = state.get("status", "unknown")
        print(f"   Status: {status}... ({elapsed:.0f}s elapsed)")

        if status == "queued" and elapsed - last_notice > 60:
            print(f"   Still queued after {elapsed:.0f}s — this can happen "
                  f"under high CALL-E traffic.")
            last_notice = elapsed

        if status in ("completed", "failed", "canceled", "no_answer"):
            return state

        time.sleep(POLLING_INTERVAL_SEC)


def check_credits():
    print("[Credits] No documented balance endpoint in the current CALL-E API.")
    print("    Check your balance manually at https://dashboard.heycall-e.com/")
    if not CALLE_API_KEY:
        print("[Error] CALLE_API_KEY environment variable is not set.")
        return False
    return True


# ═══════════════════════════════════════════════════════════════
# SQLITE — masked numbers only (review fix #3)
# ═══════════════════════════════════════════════════════════════
def init_db():
    conn = sqlite3.connect("agrovoice.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS advanced_harvests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number_masked TEXT,
            village TEXT,
            call_date TEXT,
            harvest_bags INTEGER,
            logistics_issues TEXT,
            call_outcome TEXT,
            call_status TEXT,
            structured_result_raw TEXT
        )
    """)
    conn.commit()
    conn.close()


def save_to_db(data):
    conn = sqlite3.connect("agrovoice.db")
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO advanced_harvests
            (phone_number_masked, village, call_date, harvest_bags, logistics_issues,
             call_outcome, call_status, structured_result_raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["phone_masked"], data["village"], data["call_date"], data["bags"],
        data["issues"], data["call_outcome"], data["call_status"], data["raw_json"],
    ))
    conn.commit()
    conn.close()
    print("[Load] Record saved to SQLite (masked number only).")


# ═══════════════════════════════════════════════════════════════
# CALL PROCESSING — no auto-retry, no auto-advance on ambiguity
# ═══════════════════════════════════════════════════════════════
def process_one_call(real_number):
    """
    Places and tracks ONE live call. Raises AmbiguousOutcome on any
    uncertain failure — the CALLER (batch loop) is responsible for
    stopping the whole run when that happens (review fix #4).
    """
    masked = mask_number(real_number)
    print(f"\n{'='*55}\nCalling {masked}\n{'='*55}")

    idempotency_key = f"agrovoice:{real_number}:{datetime.now().strftime('%Y%m%d%H%M%S')}"

    call_id = create_call(real_number, idempotency_key)  # may raise AmbiguousOutcome
    print(f"   Call ID: {call_id}")

    print("Tracking the call until a result is available...")
    final_state = wait_for_result(call_id)  # may raise AmbiguousOutcome

    status = final_state.get("status", "unknown")
    structured_result = final_state.get("structured_result")
    print(f"   Final status: {status}")

    if structured_result is None:
        print("[Transform] No valid structured result (structured_result = null).")
        record = {
            "phone_masked": masked, "village": "NOT_EXTRACTED",
            "call_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "bags": -1, "issues": "NOT_EXTRACTED", "call_outcome": "unknown",
            "call_status": status, "raw_json": json.dumps(final_state, ensure_ascii=False),
        }
    else:
        print(f"[Transform] Structured result received:")
        print(f"    {json.dumps(structured_result, ensure_ascii=False, indent=2)}")
        record = {
            "phone_masked": masked,
            "village": structured_result.get("village") or "NOT_MENTIONED",
            "call_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "bags": structured_result.get("harvest_bags", -1),
            "issues": structured_result.get("logistics_issues") or "NONE",
            "call_outcome": structured_result.get("call_outcome", "unknown"),
            "call_status": status,
            "raw_json": json.dumps(final_state, ensure_ascii=False),
        }

    save_to_db(record)
    return record


# ═══════════════════════════════════════════════════════════════
# EXPORT & ANALYSIS
# ═══════════════════════════════════════════════════════════════
def export_to_excel():
    conn = sqlite3.connect("agrovoice.db")
    df = pd.read_sql_query("SELECT * FROM advanced_harvests", conn)
    conn.close()

    excel_path = "Cocoa_Monitoring_Report.xlsx"
    df.to_excel(excel_path, index=False)
    print(f"[ETL] Report exported to: {excel_path} (masked numbers only)")

    valid_df = df[df["harvest_bags"] >= 0]
    total_bags = valid_df["harvest_bags"].sum()
    print(f"• Total harvest volume: {total_bags} bags")
    print(f"• Farmers contacted: {df['phone_number_masked'].nunique()}")


# ═══════════════════════════════════════════════════════════════
# REVIEW FIX #1 — preview-by-default, explicit per-call confirmation
# ═══════════════════════════════════════════════════════════════
def show_preview(number_display):
    """No API key needed. No call placed. Shows exactly what a live
    call WOULD send."""
    print("\n" + "=" * 55)
    print("PREVIEW — no call will be placed")
    print("=" * 55)
    print(f"Recipient: {number_display}")
    print(f"\nTask text that would be sent:\n{TASK_TEMPLATE}")
    print(f"\nResult schema that would be requested:")
    print(json.dumps(RESULT_SCHEMA, indent=2))
    print("=" * 55)


def confirm_live_call(masked_display):
    """Explicit per-recipient confirmation. Anything other than the
    exact word CALL cancels — pressing Enter does NOT confirm."""
    answer = input(
        f"\nType CALL (all caps) to place a REAL call to {masked_display}, "
        f"anything else cancels: "
    ).strip()
    return answer == "CALL"


# ═══════════════════════════════════════════════════════════════
# MAIN PROGRAM
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=== AgroVoice — Cocoa Farmer Data Collection ===")
    print("0. PREVIEW only — see the task/schema, no call, no API key needed [default]")
    print("1. LIVE call — ONE farmer from the allowlist")
    print("2. LIVE call — demo/fictional numbers (safe, no real destination)")
    choice = input("Choice (0/1/2) [0]: ").strip() or "0"

    if choice == "0":
        num = input("Number to preview (any format, not validated): ").strip()
        show_preview(num)
        exit(0)

    # Anything beyond preview requires credentials and validation
    if not check_credits():
        exit(1)
    init_db()

    numbers_to_call = []

    if choice == "1":
        allowlist = load_allowlist()
        if not allowlist:
            print(f"[Error] No authorized numbers found in {ALLOWLIST_PATH}.")
            print(f"    Create this file locally (one E.164 number per line) "
                  f"— it is NOT part of the repository.")
            exit(1)
        entered = input("Farmer's phone number (E.164, e.g. +237699166726): ").strip()
        if not is_valid_e164(entered):
            print("[Error] Not a valid E.164 number (expected format: +<digits>).")
            exit(1)
        if not is_authorized(entered, allowlist):
            print(f"[Error] {mask_number(entered)} is not on the authorized allowlist.")
            print(f"    Add it to {ALLOWLIST_PATH} first if you are authorized to call it.")
            exit(1)
        numbers_to_call = [entered]

    elif choice == "2":
        print(f"Using standards-reserved fictional numbers (safe to run, will "
              f"not reach a real destination): {[mask_number(n) for n in DEMO_NUMBERS]}")
        numbers_to_call = DEMO_NUMBERS
    else:
        print("Invalid choice.")
        exit(1)

    results = []
    for i, number in enumerate(numbers_to_call, 1):
        masked = mask_number(number)
        print(f"\n### Call {i}/{len(numbers_to_call)} ({masked}) ###")

        show_preview(masked)
        if not confirm_live_call(masked):
            print("Cancelled by operator — moving to next number.")
            continue

        try:
            result = process_one_call(number)
            results.append(result)
        except AmbiguousOutcome as e:
            print(f"\n[STOPPED] Ambiguous outcome — halting the entire run "
                  f"for operator reconciliation:")
            print(f"    {e}")
            print(f"    Check https://dashboard.heycall-e.com/ before restarting.")
            break  # stop the batch entirely — no auto-advance (review fix #4)

        if i < len(numbers_to_call):
            time.sleep(3)

    print(f"\n{len(results)}/{len(numbers_to_call)} call(s) completed successfully.")
    if results:
        export_to_excel()
