"""
Module 3 — CALL-E execution pipeline.
plan → (human gate) → run → poll → classify → store
"""
import json
import re
import time
import subprocess
import sys
import concurrent.futures as _cf
import queue as _queue
import threading as _threading
from pathlib import Path

import os as _os
import shutil as _shutil
import sys as _sys

def _find_calle() -> str:
    found = _shutil.which("calle")
    if found:
        return found
    if _sys.platform == "win32":
        appdata = _os.environ.get("APPDATA", "")
        candidate = Path(appdata) / "npm" / "calle.cmd"
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(
        "calle not found. Install with: npm install -g @calle-ai/cli"
    )

_NODE_DIR = r"C:\Program Files\nodejs" if _sys.platform == "win32" else ""
CALLE = _find_calle()
_CALLE_ENV = (
    {**_os.environ, "PATH": _NODE_DIR + ";" + _os.environ.get("PATH", "")}
    if _NODE_DIR else _os.environ
)
POLL_INTERVAL = 15
MAX_POLLS = 40  # 10 minutes max per call


# Live event streaming registry (run_id -> Queue)
_live_lock = _threading.Lock()
_LIVE_QUEUES: dict = {}

def register_live_queue(run_id: str) -> _queue.Queue:
    q = _queue.Queue(maxsize=100)
    with _live_lock:
        _LIVE_QUEUES[run_id] = q
    return q

def _publish_live(run_id: str, event: dict) -> None:
    with _live_lock:
        q = _LIVE_QUEUES.get(run_id)
    if q:
        try:
            q.put_nowait(event)
        except _queue.Full:
            pass  # Drop if consumer is slow

def unregister_live_queue(run_id: str) -> None:
    with _live_lock:
        _LIVE_QUEUES.pop(run_id, None)

def active_live_runs() -> list:
    with _live_lock:
        return list(_LIVE_QUEUES.keys())


def _call_groq(client, **kwargs):
    return client.chat.completions.create(**kwargs)


def _run(args: list[str]) -> dict:
    result = subprocess.run(
        [CALLE] + args,
        capture_output=True, text=True, encoding="utf-8", env=_CALLE_ENV
    )
    if result.returncode != 0:
        raise RuntimeError(f"calle {' '.join(args)} failed:\n{result.stderr}")
    try:
        outer = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        snippet = result.stdout[-300:] if result.stdout else "(empty)"
        raise RuntimeError(f"calle JSON parse error: {e}\nStdout tail: {snippet}") from e
    # CLI wraps everything in {ok, result: {structuredContent, content, isError}}
    # Return structuredContent directly so callers get the flat schema
    return outer.get("result", {}).get("structuredContent") or outer


def plan_call(phone: str, goal: str, region: str = None, language: str = None) -> dict:
    args = ["call", "plan", "--to-phone", phone, "--goal", goal]
    if region:
        args += ["--region", region]
    if language:
        args += ["--language", language]
    return _run(args)


def run_call(plan_id: str, confirm_token: str) -> dict:
    return _run(["call", "run", "--plan-id", plan_id, "--confirm-token", confirm_token])


TERMINAL_STATUSES = {"COMPLETED","FAILED","NO_ANSWER","NO ANSWER","BUSY","CANCELLED","DECLINED",
                     "completed","failed","no_answer","no answer","busy","cancelled","declined"}

_FETCH_RETRY_BUDGET = 3  # transient fetch-failed retries per poll cycle

def poll_until_done(run_id: str, on_update=None) -> dict:
    fetch_fails = 0
    for _ in range(MAX_POLLS):
        try:
            status = _run(["call", "status", "--run-id", run_id])
            fetch_fails = 0  # reset on success
        except RuntimeError as e:
            if "fetch failed" in str(e).lower() and fetch_fails < _FETCH_RETRY_BUDGET:
                fetch_fails += 1
                print(f"  [Poll] Transient fetch error (attempt {fetch_fails}/{_FETCH_RETRY_BUDGET}), retrying...")
                time.sleep(POLL_INTERVAL)
                continue
            raise  # exhaust budget or non-transient error
        _publish_live(run_id, {
            "type": "status",
            "status": status.get("status", ""),
            "transcript": parse_transcript_to_json(status),
            "summary": (status.get("result") or {}).get("summary", ""),
        })
        if on_update:
            on_update(status)
        raw = status.get("status", "")
        if raw in TERMINAL_STATUSES or raw.upper().replace(" ", "_") in TERMINAL_STATUSES:
            _publish_live(run_id, {"type": "done", "status": status.get("status", "")})
            return status
        time.sleep(POLL_INTERVAL)
    final_status = _run(["call", "status", "--run-id", run_id])
    _publish_live(run_id, {
        "type": "status",
        "status": final_status.get("status", ""),
        "transcript": parse_transcript_to_json(final_status),
        "summary": (final_status.get("result") or {}).get("summary", ""),
    })
    if on_update:
        on_update(final_status)
    _publish_live(run_id, {"type": "done", "status": final_status.get("status", "")})
    return final_status


def classify_round1(status_output: dict) -> str:
    """
    Returns one of: positive | negative | no_answer | failed
    Uses CALL-E's own outcome/status field as primary signal,
    then falls back to transcript keyword scan if available.
    """
    call_status = status_output.get("status", "").upper().replace(" ", "_")
    if call_status in ("NO_ANSWER", "BUSY", "DECLINED"):
        return "no_answer"
    if call_status == "FAILED":
        return "failed"

    # report_blocked = vendor requested callback; must be positive to trigger R2 scheduling
    if status_output.get("callback_requested"):
        return "positive"
    next_step = status_output.get("next_step") or {}
    if isinstance(next_step, dict) and next_step.get("action") == "report_blocked":
        return "positive"

    # result.outcome.task_completed is the primary CALL-E signal
    result = status_output.get("result") or {}
    outcome_obj = result.get("outcome") or {}
    if isinstance(outcome_obj, dict):
        if outcome_obj.get("task_completed") is True:
            return "positive"
        if outcome_obj.get("task_completed") is False and call_status == "COMPLETED":
            return "negative"

    # Fall back to transcript scan
    transcript = _extract_transcript_text(status_output)
    positive_signals = ["yes", "interested", "sure", "happy to", "let's talk", "send me", "follow up"]
    negative_signals = ["not interested", "no thank you", "don't need", "already have", "remove"]
    score = 0
    for sig in positive_signals:
        if sig in transcript.lower():
            score += 1
    for sig in negative_signals:
        if sig in transcript.lower():
            score -= 2
    if score > 0:
        return "positive"
    if score < 0:
        return "negative"
    return "unknown"


def _extract_transcript_text(status_output: dict) -> str:
    result = status_output.get("result") or {}
    # transcript lives at result.transcript OR result.extracted.transcript
    transcript = (result.get("transcript")
                  or (result.get("extracted") or {}).get("transcript")
                  or "")
    if isinstance(transcript, list):
        return " ".join(t.get("text", "") or t.get("content", "") for t in transcript)
    if isinstance(transcript, str):
        return transcript
    return ""


def extract_round2_fields(status_output: dict) -> dict:
    """
    Extracts structured fields from a round-2 call status output.
    Returns a dict of whatever was captured.
    """
    result = status_output.get("result") or {}
    structured = result.get("extracted") or result.get("structured_result") or {}
    if isinstance(structured, dict) and structured:
        skip = {"repair", "calling", "goal", "region", "language", "to_phones"}
        return {k: v for k, v in structured.items() if k not in skip}

    transcript = _extract_transcript_text(status_output)
    if transcript:
        return {"transcript_summary": transcript[:2000]}
    summary = result.get("summary") or result.get("post_summary") or ""
    if summary:
        return {"summary": summary}
    return {}


_TRANSCRIPT_LINE_RE = re.compile(r'^\[(\d{2}:\d{2}:\d{2})\]\s+(\w+):\s*(.*)$')


def parse_transcript_to_json(status_output: dict) -> list[dict]:
    """Parse '[HH:MM:SS] SPEAKER: text' transcript string into list of {time, speaker, text}."""
    raw = _extract_transcript_text(status_output)
    lines = []
    for line in raw.strip().splitlines():
        m = _TRANSCRIPT_LINE_RE.match(line.strip())
        if m:
            lines.append({"time": m.group(1), "speaker": m.group(2), "text": m.group(3)})
    return lines


def infer_from_transcript(transcript_lines: list[dict], product_description: str,
                           round_num: int = 1) -> dict:
    """Use Groq (Llama) to extract sales intelligence from structured transcript."""
    import os
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {"error": "GROQ_API_KEY not set"}

    if not transcript_lines:
        return {"error": "no_transcript"}

    from groq import Groq
    conversation = "\n".join(
        f"[{t['time']}] {t['speaker']}: {t['text']}" for t in transcript_lines
    )

    if round_num == 1:
        prompt = (
            f"Product being sourced: {product_description}\n\n"
            f"Transcript:\n{conversation}\n\n"
            "Return ONLY a JSON object with these exact keys:\n"
            '  "interest_level": "high" | "medium" | "low" | "none" | "unknown"\n'
            '  "sentiment": "positive" | "neutral" | "negative"\n'
            '  "key_signals": [list of short strings from the vendor\'s words]\n'
            '  "recommend_round2": true | false\n'
            '  "summary": "one-sentence outcome"\n'
            "No other text, no markdown fences."
        )
    else:
        prompt = (
            f"Product being sourced: {product_description}\n\n"
            f"Transcript:\n{conversation}\n\n"
            "Return ONLY a JSON object with these exact keys:\n"
            '  "contact_name": string or null\n'
            '  "can_supply": true | false | null\n'
            '  "quantity_mentioned": string or null\n'
            '  "price_range": string or null\n'
            '  "price_numeric": number or null  (price per unit as a plain float)\n'
            '  "currency": string or null  (ISO code, e.g. "INR", "USD")\n'
            '  "price_unit": string or null  (e.g. "per piece", "per dozen", "per kg")\n'
            '  "timeline": string or null\n'
            '  "next_steps": string or null\n'
            '  "summary": "one-sentence outcome"\n'
            "No other text, no markdown fences."
        )

    client = Groq(api_key=api_key)
    with _cf.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_call_groq, client,
                        model="groq/compound",
                        messages=[{"role": "user", "content": prompt}],
                        max_tokens=512, temperature=0.1)
        try:
            response = fut.result(timeout=20)
        except _cf.TimeoutError:
            return {"error": "groq_timeout"}
    text = response.choices[0].message.content.strip()
    # Fix UTF-8 bytes misread as Latin-1 (e.g. ₹ appearing as â‚¹)
    if "Ã" in text or "â‚" in text or "â€" in text:
        try:
            text = text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    # Strip markdown fences if model added them
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_inference": text}


def execute_call_pipeline(phone: str, goal: str, region: str = None, language: str = None,
                           dry_run: bool = False,
                           lat: float = None, lon: float = None,
                           campaign_id: int = None) -> dict:
    """
    Full plan → confirm → run → poll pipeline.
    Returns the final status output dict.
    dry_run=True plans but does not execute (for testing).
    lat/lon used for business-hours gating (skips call if outside 09:00-18:00 local).
    campaign_id, if given, is independently checked against campaigns.consent_approved_at
    here — this is the actual call-dispatch chokepoint, so a caller that skips the
    application-layer consent check (dashboard route, CLI gate, etc.) still can't get
    a real call placed for a campaign that was never approved.
    """
    from business_hours import is_business_hours, business_hours_reason
    from models import _mask_phone, get_conn

    if not dry_run and campaign_id is not None:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT consent_approved_at FROM campaigns WHERE id=?", (campaign_id,)
            ).fetchone()
        if not row or not row["consent_approved_at"]:
            print(f"  Blocking — campaign #{campaign_id} has no recorded consent.")
            return {"status": "SKIPPED", "skip_reason": "no_consent_on_record"}

    reason = business_hours_reason(lat=lat, lon=lon)
    print(f"  Hours check: {reason}")
    if not dry_run and not is_business_hours(lat=lat, lon=lon):
        print(f"  Skipping — outside business hours.")
        return {"status": "SKIPPED", "skip_reason": "outside_business_hours", "tz_info": reason}

    print(f"\n  Planning call to {_mask_phone(phone)}...")
    plan = plan_call(phone, goal, region, language)

    plan_id = plan.get("plan_id")
    confirm_token = plan.get("confirm_token")

    if not plan_id or not confirm_token:
        raise RuntimeError(f"plan_call did not return plan_id/confirm_token: {plan}")

    print(f"  Plan ID: {plan_id}")

    if dry_run:
        print("  [DRY RUN] Skipping execution.")
        return {"status": "dry_run", "plan": plan}

    print("  Executing call...")
    run_result = run_call(plan_id, confirm_token)
    run_id = run_result.get("run_id") or run_result.get("id")
    if not run_id:
        raise RuntimeError(f"run_call did not return run_id: {run_result}")

    print(f"  Run ID: {run_id} — polling for completion...")
    register_live_queue(run_id)
    final_status = poll_until_done(run_id)
    unregister_live_queue(run_id)
    raw_status = (final_status.get("status") or "").upper().replace(" ", "_")
    print(f"  Done. Status: {raw_status}")

    # Detect CALLE's report_blocked — vendor requested a callback but CALLE won't auto-retry.
    # Inject a synthetic "callback_requested" key so callers can detect and schedule.
    next_step = final_status.get("next_step") or {}
    if isinstance(next_step, dict) and next_step.get("action") == "report_blocked":
        final_status["callback_requested"] = True
        print("  [Pipeline] CALLE report_blocked — callback scheduling handed to us.")

    return final_status
