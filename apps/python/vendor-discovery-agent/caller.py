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

from call_safety import (ATTESTED_BASIS, validate_e164, mask_phone, redact_phones,
                         safe_plan)

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


# Live event streaming registry (live_id -> Queue)
#
# The live channel is keyed on a *live_id* minted before dialing, not on CALL-E's
# run_id: run_id only exists after plan_call + run_call return (15-40s), and the
# Live tab has to show "we are calling X" during that window rather than a blank
# console. poll_until_done() therefore takes an explicit live_id.
_live_lock = _threading.Lock()
_LIVE_QUEUES: dict = {}
_LIVE_ORDER: list = []      # registration order, oldest first
_LIVE_BACKLOG: dict = {}    # live_id -> last few events, replayed to a late consumer
_live_seq = 0
_LIVE_BACKLOG_MAX = 40

def register_live_queue(run_id: str) -> _queue.Queue:
    """Idempotent: a consumer attaching to a live run reuses the producer's queue
    instead of silently replacing it (which used to drop every event published
    between the producer registering and the browser connecting)."""
    with _live_lock:
        q = _LIVE_QUEUES.get(run_id)
        if q is None:
            q = _queue.Queue(maxsize=500)
            _LIVE_QUEUES[run_id] = q
            _LIVE_ORDER.append(run_id)
    return q

def attach_live_queue(run_id: str):
    """Consumer-side attach: returns (queue, backlog) for a run that is still live,
    or (None, []) if it has already finished. Never creates a new entry, so a late
    SSE connection can't resurrect a finished run as a zombie in active_live_runs()."""
    with _live_lock:
        q = _LIVE_QUEUES.get(run_id)
        if q is None:
            return None, []
        # Everything already queued is also in the backlog (_publish_live records it
        # first), so drain the queue before handing the backlog over — otherwise the
        # consumer replays the history and then receives the same events again.
        while True:
            try:
                q.get_nowait()
            except _queue.Empty:
                break
        return q, list(_LIVE_BACKLOG.get(run_id) or [])

def live_backlog(run_id: str) -> list:
    with _live_lock:
        return list(_LIVE_BACKLOG.get(run_id) or [])

def _publish_live(run_id: str, event: dict) -> None:
    with _live_lock:
        q = _LIVE_QUEUES.get(run_id)
        backlog = _LIVE_BACKLOG.setdefault(run_id, [])
        backlog.append(event)
        del backlog[:-_LIVE_BACKLOG_MAX]
    if q:
        try:
            q.put_nowait(event)
        except _queue.Full:
            pass  # Drop if consumer is slow

def unregister_live_queue(run_id: str) -> None:
    with _live_lock:
        _LIVE_QUEUES.pop(run_id, None)
        _LIVE_BACKLOG.pop(run_id, None)
        try:
            _LIVE_ORDER.remove(run_id)
        except ValueError:
            pass

def active_live_runs() -> list:
    """Newest first — the dashboard opens runs[0], and in a sequential campaign the
    interesting run is always the one that just started, not the oldest still-open one."""
    with _live_lock:
        return [r for r in reversed(_LIVE_ORDER) if r in _LIVE_QUEUES]

def _next_live_id() -> str:
    global _live_seq
    with _live_lock:
        _live_seq += 1
        return f"live-{int(time.time())}-{_live_seq}"

# campaign_id -> total leads queued when the campaign's first call was dialed,
# so the console can say "(2 of 5)" for a sequential run.
_LIVE_CAMPAIGN_TOTALS: dict = {}

def _live_lead_context(phone: str, campaign_id) -> tuple:
    """(label, index, total) for the lead about to be dialed. Best-effort only —
    never let live-console cosmetics break a call."""
    label, index, total = None, None, None
    try:
        from models import get_conn, _mask_phone
        label = _mask_phone(phone)
        if campaign_id is None:
            return label, None, None
        with get_conn() as conn:
            row = conn.execute(
                "SELECT name FROM leads WHERE campaign_id=? AND phone=? LIMIT 1",
                (campaign_id, phone)
            ).fetchone()
            if row and row["name"]:
                label = row["name"]
            remaining = conn.execute(
                "SELECT COUNT(*) AS c FROM leads WHERE campaign_id=? AND status='not_called'",
                (campaign_id,)
            ).fetchone()["c"]
        remaining = max(int(remaining or 0), 1)  # this lead is still 'not_called'
        prev_total = _LIVE_CAMPAIGN_TOTALS.get(campaign_id)
        if prev_total is None or remaining > prev_total:
            prev_total = remaining          # first lead of this campaign run
            _LIVE_CAMPAIGN_TOTALS[campaign_id] = prev_total
        total = prev_total
        index = total - remaining + 1
    except Exception:
        pass
    return label, index, total


def _call_groq(client, **kwargs):
    return client.chat.completions.create(**kwargs)


_RUN_ID_IN_TEXT_RE = re.compile(r"\brun_id\b[\"'\s:=]+([A-Za-z0-9_-]+)")


def _run_id_from_content(result) -> str:
    """Last-resort run_id scrape from the MCP content blocks, mirroring the CLI's
    own extractRunId() fallback for responses that carry no structured run_id."""
    if not isinstance(result, dict):
        return ""
    blocks = result.get("content")
    if not isinstance(blocks, list):
        return ""
    text = "\n".join(b.get("text", "") for b in blocks
                     if isinstance(b, dict) and isinstance(b.get("text"), str))
    m = _RUN_ID_IN_TEXT_RE.search(text)
    return m.group(1) if m else ""


_TIMEOUT_RETRY_BUDGET = 2  # extra attempts for read-only/planning requests only


class AmbiguousCallSubmission(RuntimeError):
    """`calle call run` did not return a clean answer. The call may or may not have
    been placed, so it must never be retried automatically."""


def _failure_kind(stderr: str) -> str:
    """Coarse, non-sensitive category for a failed calle invocation. Raw stderr can
    echo the destination, goal or provider internals, so it is never surfaced."""
    s = (stderr or "").lower()
    if "timed out" in s or "timeout" in s:
        return "timed out"
    if "fetch failed" in s:
        return "fetch failed"
    if "unauthor" in s or "login" in s or "401" in s:
        return "not authenticated"
    return "error"


def _run(args: list[str]) -> dict:
    # Without an explicit timeout the calle CLI's own default can be shorter than
    # a real response sometimes takes (~15-20s observed for plan_call, including
    # for a rejected/unsupported-region response) — that gap was showing up as a
    # generic "MCP request timed out" instead of the actual answer.
    if "--timeout-seconds" not in args:
        args = args + ["--timeout-seconds", "60"]

    # Only the command name (e.g. "call plan") is ever put in an error message —
    # never the arguments (phone number, goal, tokens) or raw stderr.
    cmd = " ".join(args[:2])
    # `call run` is the one command that places a call. A timeout or error there is
    # an ambiguous submission: the call may already be ringing, so it is NEVER
    # retried here. Plan/status requests have no side effects and may be retried.
    is_submission = args[:2] == ["call", "run"]

    attempt = 0
    while True:
        result = subprocess.run(
            [CALLE] + args,
            capture_output=True, text=True, encoding="utf-8", env=_CALLE_ENV
        )
        if result.returncode != 0:
            kind = _failure_kind(result.stderr)
            if is_submission:
                raise AmbiguousCallSubmission(
                    f"calle {cmd} {kind} (exit {result.returncode}); outcome unknown, not retried")
            if kind == "timed out" and attempt < _TIMEOUT_RETRY_BUDGET:
                attempt += 1
                print(f"  [Retry] calle {cmd} timed out (attempt {attempt}/{_TIMEOUT_RETRY_BUDGET})...")
                time.sleep(3)
                continue
            raise RuntimeError(f"calle {cmd} failed: {kind} (exit {result.returncode})")
        break

    try:
        outer = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        if is_submission:
            raise AmbiguousCallSubmission(
                f"calle {cmd} returned an unreadable response; outcome unknown, not retried") from None
        raise RuntimeError(f"calle {cmd} returned an unreadable response") from None
    # CLI wraps everything in {ok, result: {structuredContent, content, isError}}
    # Return structuredContent directly so callers get the flat schema.
    #
    # Exception that used to break every real call: `calle call run` puts the
    # run_id on the OUTER envelope and sets `result` to the *get_call_run status*
    # payload, which carries no run_id of its own:
    #     {ok, tool_name: "run_call", result: <statusResult>, run_id, run_result}
    # Unwrapping blindly to structuredContent threw the envelope away, so the id
    # was lost and execute_call_pipeline raised "run_call did not return run_id"
    # on every call -- after the vendor had already been dialed. Carry the
    # envelope's run_id across the unwrap, with the same content-text fallback
    # the CLI itself uses.
    inner = outer.get("result")
    structured = inner.get("structuredContent") if isinstance(inner, dict) else None
    payload = structured if isinstance(structured, dict) and structured else outer
    if isinstance(payload, dict) and not payload.get("run_id"):
        run_id = outer.get("run_id") or _run_id_from_content(inner)
        if run_id:
            payload = {**payload, "run_id": run_id}
    return payload


def plan_call(phone: str, goal: str, region: str = None, language: str = None) -> dict:
    args = ["call", "plan", "--to-phone", phone, "--goal", goal]
    if region:
        args += ["--region", region]
    if language:
        args += ["--language", language]
    return _run(args)


def run_call(plan_id: str, confirm_token: str) -> dict:
    return _run(["call", "run", "--plan-id", plan_id, "--confirm-token", confirm_token])


# CALL-E currently dials US / India / Singapore / Australia only. For anywhere else
# plan_call answers with clarifying_questions and no confirm_token — that is a real,
# explainable answer, not a crash, so its text has to reach the dashboard verbatim
# instead of being dumped into a RuntimeError message.
_REJECTION_KEYS = ("message", "reason", "error", "summary", "detail", "status_reason")
_UNSUPPORTED_REGION_RE = re.compile(
    r"region|country|unsupported|not supported|not available|coverage", re.I)


def plan_rejection_reason(plan: dict) -> str:
    """Human-readable text explaining why a plan came back without a confirm token."""
    questions = plan.get("clarifying_questions") or []
    if isinstance(questions, str):
        questions = [questions]
    if isinstance(questions, list) and questions:
        parts = []
        for q in questions:
            if isinstance(q, dict):
                q = q.get("question") or q.get("text") or q.get("prompt") or json.dumps(q)
            text = str(q).strip()
            if text:
                parts.append(text)
        if parts:
            return " ".join(parts)[:400]
    for key in _REJECTION_KEYS:
        val = plan.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()[:400]
    return ""


def describe_plan_rejection(plan: dict) -> str:
    """Turn a non-dialable plan response into a short skip_reason a human can read."""
    reason = redact_phones(plan_rejection_reason(plan))
    if reason and _UNSUPPORTED_REGION_RE.search(reason):
        return f"region not supported: {reason}"
    if reason:
        return f"call not planned: {reason}"
    # The raw plan carries the destination number, so it is never echoed here.
    return "call not planned: CALL-E returned no confirm token"


TERMINAL_STATUSES = {"COMPLETED","FAILED","NO_ANSWER","NO ANSWER","BUSY","CANCELLED","DECLINED",
                     "completed","failed","no_answer","no answer","busy","cancelled","declined"}

# The live console prints a "DONE — <status>" line verbatim, so the terminal status
# published there has to read like a sentence, not like an enum member.
_TERMINAL_LABELS = {
    "COMPLETED": "COMPLETED — call ended",
    "NO_ANSWER": "NO ANSWER — nobody picked up",
    "BUSY":      "BUSY — line was busy",
    "DECLINED":  "DECLINED — call rejected",
    "CANCELLED": "CANCELLED — call cancelled",
    "FAILED":    "FAILED — call could not complete",
}

def terminal_label(raw_status: str) -> str:
    key = (raw_status or "").upper().replace(" ", "_")
    return _TERMINAL_LABELS.get(key, raw_status or "finished")

_FETCH_RETRY_BUDGET = 3  # transient fetch-failed retries per poll cycle

def poll_until_done(run_id: str, on_update=None, live_id: str = None, live_meta: dict = None) -> dict:
    live_id = live_id or run_id
    live_meta = live_meta or {}
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
        _publish_live(live_id, _masked_status_event(status, live_meta))
        if on_update:
            on_update(status)
        raw = status.get("status", "")
        if raw in TERMINAL_STATUSES or raw.upper().replace(" ", "_") in TERMINAL_STATUSES:
            _publish_live(live_id, {"type": "done", "status": terminal_label(status.get("status", "")), **live_meta})
            return status
        time.sleep(POLL_INTERVAL)
    final_status = _run(["call", "status", "--run-id", run_id])
    _publish_live(live_id, _masked_status_event(final_status, live_meta))
    if on_update:
        on_update(final_status)
    raw = final_status.get("status", "")
    if not (raw in TERMINAL_STATUSES or raw.upper().replace(" ", "_") in TERMINAL_STATUSES):
        # Still not terminal after the polling budget: the outcome is unknown. Mark it
        # so no caller treats it as a clean failure and redials.
        final_status["ambiguous"] = True
        _publish_live(live_id, {"type": "done",
                                "status": "UNKNOWN — still in progress at poll timeout; not retried",
                                **live_meta})
        return final_status
    _publish_live(live_id, {"type": "done", "status": terminal_label(raw), **live_meta})
    return final_status


def _masked_status_event(status: dict, live_meta: dict) -> dict:
    """Live-console event with phone numbers redacted from transcript and summary."""
    transcript = [
        {**line, "text": redact_phones(line.get("text", ""))}
        for line in parse_transcript_to_json(status)
    ]
    return {
        "type": "status",
        "status": status.get("status", ""),
        "transcript": transcript,
        "summary": redact_phones((status.get("result") or {}).get("summary", "") or ""),
        **live_meta,
    }


def classify_round1(status_output: dict) -> str:
    """
    Returns one of: positive | negative | no_answer | busy | declined |
                    failed | cancelled | unknown
    Uses CALL-E's own outcome/status field as primary signal,
    then falls back to transcript keyword scan if available.

    BUSY / DECLINED / CANCELLED used to collapse into no_answer|failed, which made the
    dashboard say "no answer" for a vendor who actively rejected the call. Each real
    CALL-E terminal status now keeps its own name so the UI can state what happened.
    """
    call_status = status_output.get("status", "").upper().replace(" ", "_")
    if call_status == "NO_ANSWER":
        return "no_answer"
    if call_status == "BUSY":
        return "busy"
    if call_status == "DECLINED":
        return "declined"
    if call_status == "CANCELLED":
        return "cancelled"
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
                           campaign_id: int = None,
                           recipient_authorized: bool = False) -> dict:
    """
    Full plan → confirm → run → poll pipeline.
    Returns the final status output dict.
    dry_run=True plans but does not execute (for testing).
    lat/lon used for business-hours gating (skips call if outside 09:00-18:00 local).

    This is the actual call-dispatch chokepoint. Before any live call it independently
    checks, regardless of which caller (CLI, dashboard, assistant, scheduler) got here:
      * the destination is exact ASCII E.164 and belongs to `region`;
      * the operator has attested that the recipient authorized the call — recorded on
        the campaign (consent_basis == ATTESTED_BASIS) when campaign_id is given, or
        passed explicitly as recipient_authorized=True for a one-off call.
    Discovering a vendor in a public directory is not recipient authorization.

    A `call run` that times out or returns no run_id is an ambiguous submission: the
    call may have been placed. It is returned as SKIPPED with an
    "ambiguous_submission" reason and is never retried automatically.
    """
    from business_hours import is_business_hours, business_hours_reason
    from models import get_conn

    ok, why = validate_e164(phone, region)
    if not ok:
        print(f"  Blocking — invalid destination {mask_phone(phone)}: {why}.")
        return {"status": "SKIPPED", "skip_reason": f"invalid_destination: {why}"}

    if not dry_run:
        if not region:
            print("  Blocking — live calls require an explicit region.")
            return {"status": "SKIPPED", "skip_reason": "region_required_for_live_call"}
        if campaign_id is not None:
            with get_conn() as conn:
                row = conn.execute(
                    "SELECT consent_approved_at, consent_basis FROM campaigns WHERE id=?",
                    (campaign_id,)
                ).fetchone()
            if not row or not row["consent_approved_at"]:
                print(f"  Blocking — campaign #{campaign_id} has no recorded consent.")
                return {"status": "SKIPPED", "skip_reason": "no_consent_on_record"}
            if row["consent_basis"] != ATTESTED_BASIS:
                print(f"  Blocking — campaign #{campaign_id} has no recipient-authorization attestation.")
                return {"status": "SKIPPED", "skip_reason": "no_recipient_authorization_attestation"}
        elif not recipient_authorized:
            print("  Blocking — no recipient-authorization attestation for this call.")
            return {"status": "SKIPPED", "skip_reason": "no_recipient_authorization_attestation"}

    reason = business_hours_reason(lat=lat, lon=lon)
    print(f"  Hours check: {reason}")
    if not dry_run and not is_business_hours(lat=lat, lon=lon):
        print(f"  Skipping — outside business hours.")
        return {"status": "SKIPPED", "skip_reason": "outside_business_hours", "tz_info": reason}

    # Live console: open the channel BEFORE dialing, so the Live tab lights up on
    # the first poll after the user clicks Start rather than staying blank for the
    # 15-40s that plan_call + run_call take. The try/finally below also guarantees
    # the channel is torn down on failure — a leaked entry used to leave the
    # dashboard subscribed to a dead run for the rest of the campaign.
    live_label, live_index, live_total = _live_lead_context(phone, campaign_id)
    live_meta = {"lead": live_label, "index": live_index, "total": live_total}
    live_id = _next_live_id()
    register_live_queue(live_id)
    _progress = f" ({live_index} of {live_total})" if live_index and live_total else ""
    try:
        _publish_live(live_id, {"type": "status", "status": "PLANNING",
                                "summary": f"Preparing call to {live_label}{_progress}…",
                                **live_meta})
        print(f"\n  Planning call to {mask_phone(phone)}...")
        plan = plan_call(phone, goal, region, language)

        plan_id = plan.get("plan_id")
        confirm_token = plan.get("confirm_token")

        if not plan_id or not confirm_token:
            # Not an error — CALL-E declined to dial (unsupported region is the common
            # case) and told us why. Return it as a SKIPPED outcome so every caller's
            # existing skip handling records the reason on the lead, instead of raising
            # and leaving the dashboard with a bare "failed" badge and a traceback.
            skip_reason = describe_plan_rejection(plan)
            print(f"  Not dialable — {skip_reason}")
            _publish_live(live_id, {"type": "done",
                                    "status": "NOT DIALED — " + skip_reason[:140],
                                    "summary": skip_reason[:200], **live_meta})
            return {"status": "SKIPPED", "skip_reason": skip_reason, "plan": safe_plan(plan)}

        print(f"  Plan ID: {plan_id}")

        if dry_run:
            print("  [DRY RUN] Skipping execution.")
            _publish_live(live_id, {"type": "done", "status": "dry_run", **live_meta})
            return {"status": "dry_run", "plan": safe_plan(plan)}

        print("  Executing call...")
        _publish_live(live_id, {"type": "status", "status": "DIALING",
                                "summary": f"Dialing {live_label}{_progress}…",
                                **live_meta})
        try:
            run_result = run_call(plan_id, confirm_token)
        except AmbiguousCallSubmission as e:
            return _ambiguous(live_id, live_meta, str(e))
        run_id = run_result.get("run_id") or run_result.get("id")
        if not run_id:
            # The submission was accepted but we have no handle on it, so we can't
            # tell whether a call is ringing. Stop; never redial.
            return _ambiguous(live_id, live_meta, "call run returned no run_id; outcome unknown")

        print(f"  Run ID: {run_id} — polling for completion...")
        try:
            final_status = poll_until_done(run_id, live_id=live_id, live_meta=live_meta)
        except Exception as e:
            # The call was submitted; only its status is unknown. Treat as ambiguous.
            return _ambiguous(live_id, live_meta,
                              f"status unavailable after submission ({redact_phones(str(e))[:120]})",
                              run_id=run_id)
    except Exception as e:
        # Surface the failure in the console instead of letting the live indicator
        # spin forever on a run that will never publish another event.
        msg = redact_phones(str(e))
        _publish_live(live_id, {"type": "done",
                                "status": "FAILED — " + msg[:140],
                                "summary": msg[:200], **live_meta})
        raise
    finally:
        # The SSE generator holds its own reference to the queue, so any events
        # already published are still delivered after this de-registration.
        unregister_live_queue(live_id)
    raw_status = (final_status.get("status") or "").upper().replace(" ", "_")
    print(f"  Done. Status: {raw_status}")
    if final_status.get("ambiguous"):
        return {"status": "SKIPPED", "run_id": run_id,
                "skip_reason": "ambiguous_submission: call still unresolved at poll timeout; "
                               "not retried — check the CALL-E run before calling again"}

    # Detect CALLE's report_blocked — vendor requested a callback but CALLE won't auto-retry.
    # Inject a synthetic "callback_requested" key so callers can detect and schedule.
    next_step = final_status.get("next_step") or {}
    if isinstance(next_step, dict) and next_step.get("action") == "report_blocked":
        final_status["callback_requested"] = True
        print("  [Pipeline] CALLE report_blocked — callback scheduling handed to us.")

    return final_status


def _ambiguous(live_id: str, live_meta: dict, detail: str, run_id: str = None) -> dict:
    """Stop after an ambiguous submission. Returned as SKIPPED so every caller records
    the reason on the lead and none of them schedules a retry or redial."""
    reason = f"ambiguous_submission: {detail} — not retried; check the CALL-E run before calling again"
    print(f"  Stopping — {reason}")
    _publish_live(live_id, {"type": "done", "status": "UNKNOWN — " + detail[:120],
                            "summary": reason[:200], **live_meta})
    out = {"status": "SKIPPED", "skip_reason": reason}
    if run_id:
        out["run_id"] = run_id
    return out
