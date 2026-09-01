"""
AgroVoice — Automated data-collection pipeline for cocoa farmers via
AI-powered phone calls (CALL-E) with native structured extraction.

IMPORTANT NOTE ON LANGUAGE: this codebase, console output, and comments
are in English for hackathon judging purposes. The actual PHONE CALL
SCRIPT (TASK_TEMPLATE below) intentionally remains in French with a
Bulu-language greeting/closing ('Mbolo' / 'Akiba'), because the real
recipients of these calls are cocoa farmers in Cameroon who speak
French and local languages — translating the call script itself to
English would break the real-world use case.

Official CALL-E documentation used: https://docs.heycall-e.com/calls
"""

import os
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
CALL_TIMEOUT_SEC = 600  # 10 minutes — CALL-E calls can stay "queued"
                         # for several minutes under high load (observed
                         # during hackathon peak traffic)

# Structured result schema — CALL-E will validate and fill THESE exact
# fields during the call, extracted from the real conversation. Each
# field has an explicit fallback value for unclear answers — never a
# silently fabricated value (see doc: "structured_result is null" when
# extraction fails; handled explicitly below).
RESULT_SCHEMA = {
    "type": "object",
    "required": ["village", "harvest_bags", "logistics_issues", "call_outcome"],
    "properties": {
        "village": {
            "type": "string",
            "description": (
                "Name of the village mentioned by the farmer. "
                "Empty string if not mentioned or unclear."
            ),
        },
        "harvest_bags": {
            "type": "integer",
            "description": (
                "Number of cocoa bags harvested this week, as stated "
                "by the farmer. Use -1 if the number was not clearly given."
            ),
        },
        "logistics_issues": {
            "type": "string",
            "description": (
                "Short summary of any road/logistics difficulties "
                "mentioned. Empty string if none were mentioned."
            ),
        },
        "call_outcome": {
            "type": "string",
            "enum": ["completed_full", "completed_partial", "no_answer", "declined", "unknown"],
            "description": (
                "completed_full: all questions were clearly answered. "
                "completed_partial: the farmer answered some questions only. "
                "no_answer: nobody picked up or the line was unreachable. "
                "declined: the farmer refused to answer. "
                "unknown: outcome cannot be determined from call evidence."
            ),
        },
    },
    "additionalProperties": False,
}

# ⚠️ Kept in FRENCH + BULU on purpose — this is the real conversation
# heard by real cocoa farmers in Cameroon, who speak French and local
# languages, not English. See module docstring above.
TASK_TEMPLATE = (
    "Appelle immédiatement le {numero}. "
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
# CALL-E REST API CALLS
# ═══════════════════════════════════════════════════════════════
def _headers(idempotency_key=None):
    h = {
        "Authorization": f"Bearer {CALLE_API_KEY}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


def create_call(phone_number, idempotency_key):
    """
    Creates a call via POST /v1/calls, with the structured result_schema.
    Returns the created call id. Retries once on timeout (the call may
    have been accepted server-side despite the local timeout — the
    Idempotency-Key guarantees a retry won't trigger a second real call).
    """
    payload = {
        "task": TASK_TEMPLATE.format(numero=phone_number),
        "result_schema": RESULT_SCHEMA,
        "metadata": {"project": "agrovoice", "phone": phone_number},
    }

    for attempt in range(1, 3):
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
            print(f"⏱️  Timeout (attempt {attempt}/2) — retrying with the "
                  f"same idempotency key...")
            if attempt == 2:
                raise
            time.sleep(3)


def get_call_state(call_id):
    """Reads the current call state via GET /v1/calls/{call_id}."""
    response = requests.get(
        f"{CALLE_BASE_URL}/calls/{call_id}",
        headers=_headers(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def wait_for_result(call_id, timeout_sec=CALL_TIMEOUT_SEC):
    """
    Polls the call until structured_result or a terminal state is
    available. structured_result may be null when CALL-E cannot
    produce a schema-valid result from the call evidence (handled
    explicitly downstream — never fabricated).
    """
    start_time = time.time()
    last_queued_notice = 0

    while True:
        if time.time() - start_time > timeout_sec:
            return {"status": "timeout", "structured_result": None}

        state = get_call_state(call_id)
        status = state.get("status", "unknown")
        elapsed = time.time() - start_time
        print(f"   Status: {status}... ({elapsed:.0f}s elapsed)")

        # "queued" can last several minutes under high CALL-E load
        # (observed during hackathon peak traffic) — reassure the user
        # every ~60s that this is expected, not a script hang.
        if status == "queued" and elapsed - last_queued_notice > 60:
            print(f"   ℹ️  Still queued after {elapsed:.0f}s — this can "
                  f"happen under high CALL-E traffic, please wait...")
            last_queued_notice = elapsed

        if status in ("completed", "failed", "canceled", "no_answer"):
            return state

        time.sleep(POLLING_INTERVAL_SEC)


# ═══════════════════════════════════════════════════════════════
# CREDITS CHECK — full honesty, no fabricated balance
# ═══════════════════════════════════════════════════════════════
def check_credits():
    """
    The official CALL-E documentation (docs.heycall-e.com) does not
    reference any public balance/credits endpoint in the Calls or Goal
    Runs API as of this writing. We therefore do NOT simulate any
    check — we say so clearly, instead of displaying a fabricated
    number like earlier versions of this script did.
    """
    print("💰 [Credits] No documented balance endpoint in the current CALL-E API.")
    print("    Check your balance manually at https://dashboard.heycall-e.com/")
    print("    before launching a large number of calls.")
    if not CALLE_API_KEY:
        print("❌ [Error] CALLE_API_KEY environment variable is not set.")
        return False
    return True


# ═══════════════════════════════════════════════════════════════
# SQLITE DATABASE
# ═══════════════════════════════════════════════════════════════
def init_db():
    conn = sqlite3.connect("agrovoice.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS advanced_harvests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
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
            (phone_number, village, call_date, harvest_bags, logistics_issues,
             call_outcome, call_status, structured_result_raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["phone_number"], data["village"], data["call_date"], data["bags"],
        data["issues"], data["call_outcome"], data["call_status"], data["raw_json"],
    ))
    conn.commit()
    conn.close()
    print("💾 [Load] Record saved to SQLite.")


# ═══════════════════════════════════════════════════════════════
# SINGLE CALL PROCESSING
# ═══════════════════════════════════════════════════════════════
def process_one_call(phone_number):
    print(f"\n{'='*55}\n📞 Calling {phone_number}\n{'='*55}")

    idempotency_key = f"agrovoice:{phone_number}:{datetime.now().strftime('%Y%m%d%H%M%S')}"

    try:
        print("1. [Extract] Creating the call (with extraction schema)...")
        call_id = create_call(phone_number, idempotency_key)
        print(f"   Call ID: {call_id}")
    except requests.exceptions.HTTPError as e:
        print(f"❌ Call creation error: {e}")
        print(f"   Response: {e.response.text[:300] if e.response is not None else 'N/A'}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return None

    print("2. [Monitor] Tracking the call until a result is available...")
    final_state = wait_for_result(call_id)

    status = final_state.get("status", "unknown")
    structured_result = final_state.get("structured_result")

    print(f"   Final status: {status}")

    if structured_result is None:
        # Explicitly documented CALL-E behavior: extraction could not
        # produce a schema-valid result — recorded AS-IS, never faked.
        print("⚠️  [Transform] No valid structured result (structured_result = null).")
        print("    Possible causes: no answer, conversation too ambiguous,")
        print("    or the schema was not satisfied by the call evidence.")
        record = {
            "phone_number": phone_number,
            "village": "NOT_EXTRACTED",
            "call_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "bags": -1,
            "issues": "NOT_EXTRACTED",
            "call_outcome": "unknown",
            "call_status": status,
            "raw_json": json.dumps(final_state, ensure_ascii=False),
        }
    else:
        print(f"🔄 [Transform] Structured result received and validated by CALL-E:")
        print(f"    {json.dumps(structured_result, ensure_ascii=False, indent=2)}")
        record = {
            "phone_number": phone_number,
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
# EXCEL EXPORT & ANALYSIS
# ═══════════════════════════════════════════════════════════════
def export_to_excel():
    conn = sqlite3.connect("agrovoice.db")
    df = pd.read_sql_query("SELECT * FROM advanced_harvests", conn)
    conn.close()

    excel_path = "Cocoa_Monitoring_Report.xlsx"
    df.to_excel(excel_path, index=False)
    print(f"📊 [ETL] Report exported to: {excel_path}")

    print("\n" + "=" * 55)
    print("📈 OPERATIONAL ANALYSIS")
    print("=" * 55)

    valid_df = df[df["harvest_bags"] >= 0]
    total_bags = valid_df["harvest_bags"].sum()
    not_extracted_count = len(df[df["harvest_bags"] == -1])

    print(f"• Total harvest volume (valid data): {total_bags} bags")
    print(f"• Farmers contacted: {df['phone_number'].nunique()}")
    if len(valid_df) > 0:
        print(f"• Referenced villages: {sorted(valid_df['village'].unique().tolist())}")
    if not_extracted_count > 0:
        print(f"⚠️  {not_extracted_count} call(s) without valid extraction "
              f"— see 'structured_result_raw' column for diagnostics")
    print("=" * 55)


# ═══════════════════════════════════════════════════════════════
# PHONE NUMBER NORMALIZATION
# ═══════════════════════════════════════════════════════════════
def normalize_phone_number(raw_number):
    number = raw_number.strip()
    if not number.startswith("+"):
        number = "+237" + number.lstrip("0")
    return number


# ═══════════════════════════════════════════════════════════════
# MAIN PROGRAM
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    if not check_credits():
        exit(1)

    init_db()

    print("\n=== AgroVoice — Cocoa Farmer Data Collection ===")
    print("1. Call ONE farmer (manual entry)")
    print("2. Call MULTIPLE farmers (built-in demo list)")
    print("3. Call MULTIPLE farmers (from a CSV file)")
    choice = input("Choice (1/2/3): ").strip()

    numbers_to_call = []

    if choice == "1":
        entered_number = input("Farmer's phone number (e.g., +237699166726): ").strip()
        numbers_to_call = [normalize_phone_number(entered_number)]

    elif choice == "2":
        demo_numbers = ["+237699166726", "+237677123456", "+237655987654"]
        print(f"Demo list: {demo_numbers}")
        numbers_to_call = demo_numbers

    elif choice == "3":
        csv_path = input("CSV file path (one 'phone_number' column): ").strip()
        try:
            with open(csv_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                numbers_to_call = [normalize_phone_number(row["phone_number"]) for row in reader]
            print(f"{len(numbers_to_call)} number(s) loaded from {csv_path}")
        except Exception as e:
            print(f"❌ CSV read error: {e}")
            exit(1)
    else:
        print("Invalid choice.")
        exit(1)

    results = []
    for i, number in enumerate(numbers_to_call, 1):
        print(f"\n### Call {i}/{len(numbers_to_call)} ###")
        result = process_one_call(number)
        if result:
            results.append(result)
        if i < len(numbers_to_call):
            time.sleep(3)

    print(f"\n✅ {len(results)}/{len(numbers_to_call)} call(s) processed.")
    export_to_excel()
