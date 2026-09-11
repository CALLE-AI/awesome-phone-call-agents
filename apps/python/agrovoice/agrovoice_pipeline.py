"""
AgroVoice — Cocoa farmer callback app (CALL-E).

CHANGES FOLLOWING SUPERSEDING REVIEW (Ray-56, 2026-09-11 policy) — the
prior review's blockers were replaced by this bounded list of 3 items:

  1. Removed the demo-number authorization bypass. There is now
     exactly ONE live-call path, and every destination — fictional or
     real — must pass the same explicit allowlist gate. No special
     case for "safe" numbers.

  2. Masking now also applies to the preview path (previously showed
     raw typed input unmasked) and to what is persisted to SQLite:
     instead of storing the full raw provider response
     (structured_result_raw), only a minimal, curated subset is kept
     (sanitize_state_for_storage()).

  3. French/Bulu task text: translated to English per AGENTS.md,
   since the maintainer's exception request did not receive a
   response before the deadline. The original French/Bulu version
   is preserved as a documented comment above TASK_TEMPLATE and in
   README.md, flagged as the intended production language for real
   farmer calls.
"""

import os
import re
import json
import time
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

RESULT_SCHEMA = {
    "type": "object",
    "required": ["village", "harvest_bags", "logistics_issues", "call_outcome"],
    "properties": {
        "village": {"type": "string", "description": "Village name, or empty string."},
        "harvest_bags": {"type": "integer", "description": "Bags harvested, or -1 if unclear."},
        "logistics_issues": {"type": "string", "description": "Logistics issues, or empty string."},
        "call_outcome": {
            "type": "string",
            "enum": ["completed_full", "completed_partial", "no_answer", "declined", "unknown"],
        },
    },
    "additionalProperties": False,
}

# LANGUAGE NOTE (review point 3 — RESOLVED by translation): this task
# text is now in English to comply with AGENTS.md's repository-facing
# content requirement, per the maintainer's still-pending exception
# request timing out against the hackathon deadline.
#
# ⚠️ REAL-WORLD CAVEAT: this English version is what ships in this
# repository, but it is NOT the intended production language. Actual
# Cameroonian cocoa farmers speak French and local languages, not
# English — deploying this English task as-is would not work for the
# real target users. The original French/Bulu task (validated in a
# real successful test call, see PROJECT_STORY.md) is preserved below
# as documented reference for real deployment, and should be swapped
# back in by any operator actually calling French-speaking farmers.
#
# Reference / production version (French + Bulu greeting):
#   "Commence par dire distinctement en langue Bulu : 'Mbolo ! Je suis
#   l'assistant de la coopérative.' Demande ensuite, dans un français
#   simple et clair : le nom du village, le nombre de sacs de cacao
#   récoltés cette semaine, et s'il y a des difficultés de route ou de
#   logistique pour l'acheminement. IMPORTANT : termine TOUJOURS la
#   conversation en disant le mot 'Akiba' (qui signifie 'merci' en
#   langue Bulu) — ce doit être la toute dernière chose prononcée,
#   juste avant de raccrocher, même si le producteur n'a pas répondu
#   à toutes les questions."
TASK_TEMPLATE = (
    "Greet the farmer by saying the word 'Mbolo' (a Bulu-language greeting), "
    "followed by: 'I am the cooperative's assistant.' Then ask, in clear, "
    "simple language: the name of their village, how many bags of cocoa they "
    "harvested this week, and whether there are any road or logistics "
    "difficulties affecting delivery. IMPORTANT: always end the conversation "
    "by saying the word 'Akiba' (meaning 'thank you' in Bulu) — this must be "
    "the very last thing said, right before hanging up, even if the farmer "
    "did not answer every question."
)


# ═══════════════════════════════════════════════════════════════
# E.164 VALIDATION + ALLOWLIST — single gate, no exceptions (fix #1)
# ═══════════════════════════════════════════════════════════════
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def is_valid_e164(number):
    return bool(E164_PATTERN.match(number))


def load_allowlist(path=ALLOWLIST_PATH):
    """
    One authorization source for ALL live calls — fictional demo
    numbers included. To test with safe NANPA-reserved numbers
    (+1-202-555-01xx), add them to this file yourself; the code
    contains no built-in bypass for any number, safe-looking or not.
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
# MASKING — applied to ALL display/storage surfaces, including
# preview input (fix #2a)
# ═══════════════════════════════════════════════════════════════
def mask_number(raw_input):
    """
    Masks any phone-number-like string for display, logs, and
    storage. Applied unconditionally — including in preview mode,
    where the previous version printed arbitrary typed input unmasked.
    """
    s = str(raw_input)
    if len(s) < 8:
        return "*" * len(s)
    return s[:4] + "*" * (len(s) - 7) + s[-3:]


def sanitize_state_for_storage(final_state):
    """
    Returns only a minimal, curated subset of the provider's response
    for persistence — never the full raw payload (fix #2b). Anything
    beyond call_id/status/structured_result is dropped, since we don't
    control what else a given provider response might include.
    """
    return {
        "call_id": final_state.get("id"),
        "status": final_state.get("status"),
        "structured_result": final_state.get("structured_result"),
    }


# ═══════════════════════════════════════════════════════════════
# CALL-E REST API
# ═══════════════════════════════════════════════════════════════
def _headers(idempotency_key=None):
    h = {"Authorization": f"Bearer {CALLE_API_KEY}", "Content-Type": "application/json"}
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


class AmbiguousOutcome(Exception):
    pass


def create_call(real_number, idempotency_key):
    payload = {
        "task": TASK_TEMPLATE,
        "recipient": {"phone": real_number},
        "result_schema": RESULT_SCHEMA,
        "metadata": {"project": "agrovoice"},
    }
    try:
        response = requests.post(
            f"{CALLE_BASE_URL}/calls", headers=_headers(idempotency_key=idempotency_key),
            json=payload, timeout=40,
        )
        response.raise_for_status()
        return response.json()["id"]
    except requests.exceptions.Timeout:
        raise AmbiguousOutcome("Timeout creating the call — outcome unknown, do not retry.")
    except requests.exceptions.RequestException as e:
        raise AmbiguousOutcome(f"Ambiguous error during call creation: {e}")


def get_call_state(call_id):
    response = requests.get(f"{CALLE_BASE_URL}/calls/{call_id}", headers=_headers(), timeout=15)
    response.raise_for_status()
    return response.json()


def wait_for_result(call_id, timeout_sec=CALL_TIMEOUT_SEC):
    start_time = time.time()
    last_notice = 0
    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout_sec:
            raise AmbiguousOutcome(f"Local polling timeout after {timeout_sec}s — status unknown.")
        state = get_call_state(call_id)
        status = state.get("status", "unknown")
        print(f"   Status: {status}... ({elapsed:.0f}s elapsed)")
        if status == "queued" and elapsed - last_notice > 60:
            print(f"   Still queued after {elapsed:.0f}s.")
            last_notice = elapsed
        if status in ("completed", "failed", "canceled", "no_answer"):
            return state
        time.sleep(POLLING_INTERVAL_SEC)


def check_credits():
    print("[Credits] No documented balance endpoint. Check https://dashboard.heycall-e.com/")
    if not CALLE_API_KEY:
        print("[Error] CALLE_API_KEY environment variable is not set.")
        return False
    return True


# ═══════════════════════════════════════════════════════════════
# SQLITE — sanitized provider response only (fix #2b)
# ═══════════════════════════════════════════════════════════════
def init_db():
    conn = sqlite3.connect("agrovoice.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS advanced_harvests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number_masked TEXT, village TEXT, call_date TEXT,
            harvest_bags INTEGER, logistics_issues TEXT, call_outcome TEXT,
            call_status TEXT, provider_response_safe TEXT
        )
    """)
    conn.commit()
    conn.close()


def save_to_db(data):
    conn = sqlite3.connect("agrovoice.db")
    conn.execute("""
        INSERT INTO advanced_harvests
            (phone_number_masked, village, call_date, harvest_bags, logistics_issues,
             call_outcome, call_status, provider_response_safe)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["phone_masked"], data["village"], data["call_date"], data["bags"],
        data["issues"], data["call_outcome"], data["call_status"], data["safe_json"],
    ))
    conn.commit()
    conn.close()
    print("[Load] Record saved (masked number, sanitized provider response).")


# ═══════════════════════════════════════════════════════════════
# CALL PROCESSING
# ═══════════════════════════════════════════════════════════════
def process_one_call(real_number):
    masked = mask_number(real_number)
    print(f"\n{'='*55}\nCalling {masked}\n{'='*55}")
    idempotency_key = f"agrovoice:{real_number}:{datetime.now().strftime('%Y%m%d%H%M%S')}"

    call_id = create_call(real_number, idempotency_key)
    print(f"   Call ID: {call_id}")
    final_state = wait_for_result(call_id)

    status = final_state.get("status", "unknown")
    structured_result = final_state.get("structured_result")
    safe_state = sanitize_state_for_storage(final_state)

    if structured_result is None:
        record = {
            "phone_masked": masked, "village": "NOT_EXTRACTED",
            "call_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "bags": -1, "issues": "NOT_EXTRACTED", "call_outcome": "unknown",
            "call_status": status, "safe_json": json.dumps(safe_state, ensure_ascii=False),
        }
    else:
        print(f"[Transform] Structured result:\n{json.dumps(structured_result, indent=2)}")
        record = {
            "phone_masked": masked,
            "village": structured_result.get("village") or "NOT_MENTIONED",
            "call_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "bags": structured_result.get("harvest_bags", -1),
            "issues": structured_result.get("logistics_issues") or "NONE",
            "call_outcome": structured_result.get("call_outcome", "unknown"),
            "call_status": status, "safe_json": json.dumps(safe_state, ensure_ascii=False),
        }

    save_to_db(record)
    return record


def export_to_excel():
    conn = sqlite3.connect("agrovoice.db")
    df = pd.read_sql_query("SELECT * FROM advanced_harvests", conn)
    conn.close()
    df.to_excel("Cocoa_Monitoring_Report.xlsx", index=False)
    print("[ETL] Report exported (masked numbers, sanitized provider data only).")


def show_preview(raw_input):
    """No API key needed, no call placed. Input is masked (fix #2a) —
    previously this printed arbitrary typed input unmasked."""
    print("\n" + "=" * 55 + "\nPREVIEW — no call will be placed\n" + "=" * 55)
    print(f"Recipient (masked): {mask_number(raw_input)}")
    print(f"\nTask text that would be sent:\n{TASK_TEMPLATE}")
    print(f"\nResult schema:\n{json.dumps(RESULT_SCHEMA, indent=2)}")


def confirm_live_call(masked_display):
    answer = input(f"\nType CALL (all caps) to place a REAL call to {masked_display}, "
                    f"anything else cancels: ").strip()
    return answer == "CALL"


# ═══════════════════════════════════════════════════════════════
# MAIN — single live-call path, no bypass for any number (fix #1)
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=== AgroVoice — Cocoa Farmer Data Collection ===")
    print("0. PREVIEW only — no call, no API key needed [default]")
    print("1. LIVE call — number must be E.164-valid AND on the local allowlist")
    choice = input("Choice (0/1) [0]: ").strip() or "0"

    if choice == "0":
        num = input("Number to preview (any format, not validated): ").strip()
        show_preview(num)
        exit(0)

    if not check_credits():
        exit(1)
    init_db()

    allowlist = load_allowlist()
    if not allowlist:
        print(f"[Error] No authorized numbers in {ALLOWLIST_PATH}.")
        print(f"    This file is local and gitignored — create it yourself, one "
              f"E.164 number per line. To test safely, add a NANPA-reserved "
              f"fictional number (e.g. +12025550142) — it is not exempted by "
              f"the code, it must be listed here like any other number.")
        exit(1)

    entered = input("Farmer's phone number (E.164, e.g. +237699166726): ").strip()
    if not is_valid_e164(entered):
        print("[Error] Not a valid E.164 number.")
        exit(1)
    if not is_authorized(entered, allowlist):
        print(f"[Error] {mask_number(entered)} is not on the authorized allowlist.")
        exit(1)

    masked = mask_number(entered)
    show_preview(entered)
    if not confirm_live_call(masked):
        print("Cancelled by operator.")
        exit(0)

    try:
        result = process_one_call(entered)
        export_to_excel()
        print(f"\n1/1 call completed.")
    except AmbiguousOutcome as e:
        print(f"\n[STOPPED] Ambiguous outcome — check https://dashboard.heycall-e.com/")
        print(f"    {e}")
