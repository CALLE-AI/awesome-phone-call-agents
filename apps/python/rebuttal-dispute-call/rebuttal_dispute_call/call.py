"""The confirmation call: one CALL-E call to the disputing customer, turned into evidence a bank can read.

    place()         create the call from a fixed script, with a strict result schema and an idempotency key
    follow()        stream CALL-E events and transcript turns until the call ends
    ground()        cross-examine CALL-E's structured result against what the customer actually said
    evidence_pdf()  render the call as a customer-communication document for the dispute

CALL-E's structured result is a claim, not evidence. A "yes" is used only when a customer turn in
the transcript says yes to that question, the automated-call disclosure was actually spoken, and
the call completed with high confidence. A "no" stops the filing even when it is not grounded:
a yes needs the customer's words, a no only needs to be possible.

Depends on nothing but the standard library (and reportlab for the PDF), so it can be lifted into
any other agent unchanged.

Adapted from Rebuttal (https://github.com/N-45div/Rebuttal, rebuttal/call.py), with
strict destination validation and display-only phone masking for this reference demo.
"""
from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

TEMPLATE_VERSION = "confirm-receipt-v2"
MIN_CONFIDENCE = 0.8
TERMINAL = {"completed", "failed", "canceled", "cancelled"}
E164 = re.compile(r"^\+[1-9][0-9]{7,14}\Z")
_PHONE_LIKE = re.compile(r"\+?\d[\d\s().-]{5,}\d")

RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["received", "recognises_charge", "purchaser", "declined_to_talk"],
    "properties": {
        "received": {"type": "string", "enum": ["yes", "no", "unknown"],
                     "description": "Did the person say they received the order?"},
        "recognises_charge": {"type": "string", "enum": ["yes", "no", "unknown"],
                              "description": "Did the person say they recognise the charge for the order?"},
        "purchaser": {"type": "string", "enum": ["cardholder", "household_member", "someone_else", "unknown"],
                      "description": "Who placed the order, in the person's own words."},
        "declined_to_talk": {"type": "string", "enum": ["yes", "no"],
                             "description": "Did the person decline to answer or ask to end the call?"},
    },
}


# ---------------------------------------------------------------- script

def disclosure(merchant: str, order_id: str) -> str:
    return (f"Hello, this is an automated assistant calling on behalf of {merchant} about your order {order_id}. "
            "This call may be recorded.")


def build_task(*, merchant: str, order_id: str, items: str, amount: str) -> str:
    """The only script Rebuttal ever sends. The model never writes what the phone says."""
    return (
        f'Start the call by saying: "{disclosure(merchant, order_id)}" '
        "Then ask two short questions, one at a time, and wait for each answer. "
        f"First, did they receive order {order_id}, {items}? "
        f"Second, do they recognise the charge of {amount} for that order? "
        "If they say someone in their household placed the order, note who. "
        "Never ask for card numbers, security codes, passwords, bank details or any other payment information. "
        "Do not mention banks, chargebacks or disputes, and do not pressure them. "
        "If they do not want to talk, thank them and end the call right away. "
        "After the two answers, thank them and end the call."
    )


def idempotency_key(dispute_id: str) -> str:
    return f"rebuttal-{TEMPLATE_VERSION}-{dispute_id}"


# ---------------------------------------------------------------- destination rules

def mask(phone: str | None) -> str:
    if not phone:
        return ""
    if len(phone) <= 7:
        return "*" * len(phone)
    return phone[:3] + "*" * (len(phone) - 7) + phone[-4:]


def scrub(text: str | None) -> str:
    """Mask phone-shaped digit runs for display, without altering grounding inputs."""
    def hide(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        return mask("+" + digits) if len(digits) >= 7 else m.group(0)
    return _PHONE_LIKE.sub(hide, text or "")


_ZONES: list[tuple[str, tuple[str, ...]]] = sorted([
    ("+1", ("America/New_York", "America/Los_Angeles")),   # every continental US/CA zone must be inside the window
    ("+44", ("Europe/London",)),
    ("+49", ("Europe/Berlin",)),
    ("+61", ("Australia/Sydney", "Australia/Perth")),
    ("+65", ("Asia/Singapore",)),
    ("+91", ("Asia/Kolkata",)),
    ("+971", ("Asia/Dubai",)),
], key=lambda z: -len(z[0]))

# September offsets, used only when the tz database is unavailable.
_FALLBACK_HOURS = {"America/New_York": -4, "America/Los_Angeles": -7, "Europe/London": 1, "Europe/Berlin": 2,
                   "Australia/Sydney": 10, "Australia/Perth": 8, "Asia/Singapore": 8, "Asia/Kolkata": 5.5, "Asia/Dubai": 4}


def _local(now: datetime, zone: str) -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return now.astimezone(ZoneInfo(zone))
    except Exception:
        return now + timedelta(hours=_FALLBACK_HOURS[zone])


def local_hours_ok(phone: str, now: datetime | None = None, start: int = 8, end: int = 21) -> tuple[bool, str]:
    """Calls land only between start and end o'clock in the recipient's local time (US TCPA hours by default)."""
    zones = next((z for cc, z in _ZONES if phone.startswith(cc)), None)
    if zones is None:
        return False, "no calling-hours rule for this country code"
    now = now or datetime.now(timezone.utc)
    for zone in zones:
        local = _local(now, zone)
        if not (start <= local.hour < end):
            return False, f"{local:%H:%M} in {zone} is outside {start:02d}:00-{end:02d}:00"
    return True, "inside local calling hours"


def authorized(phone: str, allowlist: str | list[str] | set[str] | None) -> bool:
    if not allowlist:
        return False
    items = allowlist.split(",") if isinstance(allowlist, str) else allowlist
    return phone in {p.strip() for p in items if p.strip()}


# ---------------------------------------------------------------- CALL-E

@dataclass
class CallRecord:
    call_id: str
    status: str
    task_completed: bool | None
    confidence: float | None
    result: dict[str, Any]
    summary: str
    evidence: list[str]
    turns: list[dict[str, Any]]
    events: list[dict[str, Any]] = field(default_factory=list)
    started_at: str | None = None
    completed_at: str | None = None
    failure: str | None = None
    timed_out: bool = False

    @property
    def duration_seconds(self) -> float | None:
        try:
            a = datetime.fromisoformat(self.started_at.replace("Z", "+00:00"))
            b = datetime.fromisoformat(self.completed_at.replace("Z", "+00:00"))
            return round((b - a).total_seconds(), 1)
        except Exception:
            return None


def place(client: Any, *, dispute_id: str, phone: str, merchant: str, order_id: str, items: str, amount: str,
          run_id: str = "", webhook_url: str | None = None) -> dict[str, Any]:
    """Create exactly one call for this dispute. A retry with the same dispute id returns the same call."""
    if not E164.fullmatch(phone or ""):
        raise ValueError("destination must be an E.164 number")
    kwargs: dict[str, Any] = {
        "task": build_task(merchant=merchant, order_id=order_id, items=items, amount=amount),
        "recipients": [{"phones": [phone]}],
        "result_schema": RESULT_SCHEMA,
        "metadata": {"app": "rebuttal", "purpose": "confirm_receipt", "template": TEMPLATE_VERSION,
                     "dispute_id": dispute_id, "order_id": order_id, "run_id": run_id},
        "idempotency_key": idempotency_key(dispute_id),
    }
    if webhook_url:
        kwargs["webhook_url"] = webhook_url
    return client.calls.create(**kwargs)


def record_from(call: dict[str, Any], events: list[dict[str, Any]] | None = None) -> CallRecord:
    attempts = [a for r in call.get("recipients") or [] for a in r.get("attempts") or []]
    turns = [t for a in attempts for t in a.get("transcript_turns") or []]
    started = [a["started_at"] for a in attempts if a.get("started_at")]
    ended = [a["completed_at"] for a in attempts if a.get("completed_at")]
    failure = call.get("failure_message") or call.get("failure_code") or next(
        (a.get("failure_message") or a.get("failure_code") for a in attempts if a.get("failure_code") or a.get("failure_message")), None)
    conf = (call.get("completion_confidence") or {}).get("score")
    return CallRecord(
        call_id=call.get("id") or call.get("call_id", ""), status=call.get("status", ""),
        task_completed=call.get("task_completed"), confidence=conf, result=dict(call.get("structured_result") or {}),
        summary=call.get("summary") or "", evidence=list(call.get("evidence") or []), turns=turns, events=list(events or []),
        started_at=min(started) if started else None, completed_at=max(ended) if ended else None, failure=failure,
    )


def follow(client: Any, call_id: str, *, on_event: Callable[[dict], None] | None = None,
           on_turn: Callable[[dict], None] | None = None, interval: float = 3.0, timeout: float = 600.0,
           sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> CallRecord:
    """Stream events and transcript turns until the call reaches a terminal state or the timeout."""
    seen: set[str] = set()
    events: list[dict[str, Any]] = []
    shown = 0
    deadline = clock() + timeout
    while True:
        cursor = None
        while True:
            page = client.calls.list_events(call_id, cursor=cursor, limit=100) or {}
            for e in page.get("data") or []:
                if e.get("id") not in seen:
                    seen.add(e.get("id"))
                    events.append(e)
                    if on_event:
                        on_event(e)
            cursor = page.get("next_cursor")
            if not cursor:
                break
        rec = record_from(client.calls.get(call_id) or {}, events)
        for t in rec.turns[shown:]:
            if on_turn:
                on_turn(t)
        shown = len(rec.turns)
        if rec.status in TERMINAL:
            return rec
        if clock() > deadline:
            rec.timed_out = True
            return rec
        sleep(interval)


# ---------------------------------------------------------------- grounding

_AFFIRM = re.compile(r"\b(yes|yeah|yep|yup|yah|sure|correct|right|absolutely|definitely|of course|i did|i have|"
                     r"got (it|them|the|my)|received|recogni[sz]e|that'?s (me|mine|right|correct)|it'?s mine|mhm|uh[- ]huh)\b", re.I)
_NEGATE = re.compile(r"\b(no|nope|nah|not|never|didn'?t|did not|don'?t|do not|haven'?t|have not|wasn'?t|nothing)\b", re.I)
_POLITE = re.compile(r"\b(no problem|no worries|not a problem)\b", re.I)
_RECEIVE_Q = re.compile(r"receiv|arriv|deliver|get (the|your|it)|got (the|your|it)", re.I)
_CHARGE_Q = re.compile(r"charge|payment|recogni[sz]e|amount|dollar|rupee|\$", re.I)
_DISCLOSE = re.compile(r"automated|assistant|virtual agent|\bai\b|artificial", re.I)
_CARD_ASK = re.compile(r"card number|security code|\bcvv\b|\bcvc\b|expir|password|\bpin\b|bank account|routing number|social security", re.I)
_REFUSAL_OPENING = re.compile(r"never ask|do not ask|don't ask", re.I)


def polarity(text: str) -> str | None:
    t = _POLITE.sub(" ", text or "")
    yes, no = bool(_AFFIRM.search(t)), bool(_NEGATE.search(t))
    if yes and not no:
        return "yes"
    if no and not yes:
        return "no"
    return None


def _is_caller(turn: dict[str, Any]) -> bool:
    return (turn.get("speaker") or "").lower() not in ("user", "customer", "recipient", "callee")


def _answer_after(turns: list[dict[str, Any]], question: re.Pattern, other: re.Pattern) -> dict[str, Any] | None:
    """The first customer turn with a clear yes or no after the caller asks `question`, before the next other question."""
    for i, t in enumerate(turns):
        if _is_caller(t) and question.search(t.get("text", "")):
            heard = 0
            for u in turns[i + 1:]:
                if _is_caller(u):
                    if other.search(u.get("text", "")) and not question.search(u.get("text", "")):
                        break
                    continue
                heard += 1
                if polarity(u.get("text", "")):
                    return u
                if heard >= 3:
                    break
    return None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    quote: str | None = None
    offset: float | None = None


@dataclass
class Grounding:
    reported: dict[str, Any]
    accepted: dict[str, Any]
    checks: list[Check]
    usable: bool          # may this call be filed as customer communication at all?
    denied: bool          # did CALL-E report a "no" to either question?

    def check(self, name: str) -> Check | None:
        return next((c for c in self.checks if c.name == name), None)

    def lines(self) -> list[str]:
        return [f"{'PASS' if c.passed else 'FAIL'}  {c.name}: {c.detail}" + (f' "{c.quote}"' if c.quote else "") for c in self.checks]


def ground(rec: CallRecord, merchant: str) -> Grounding:
    checks: list[Check] = []
    completed = rec.status == "completed" and rec.task_completed is not False and not rec.timed_out
    checks.append(Check("call_completed", completed, f"status {rec.status}, task_completed {rec.task_completed}"
                        + (", timed out" if rec.timed_out else "")))
    confident = (rec.confidence or 0) >= MIN_CONFIDENCE
    checks.append(Check("confidence", confident, f"completion confidence {rec.confidence} (minimum {MIN_CONFIDENCE})"))

    opening = [t for t in rec.turns if _is_caller(t)][:8]
    opening_text = " ".join(t.get("text", "") for t in opening)
    disclosed = bool(_DISCLOSE.search(opening_text)) and _norm(merchant) in _norm(opening_text)
    disclosure_turn = next((t for t in opening if _DISCLOSE.search(t.get("text", ""))), None)
    checks.append(Check("disclosure_spoken", disclosed,
                        "the caller said it was automated and named the merchant" if disclosed
                        else "the opening never said it was an automated call on behalf of the merchant",
                        quote=disclosure_turn.get("text") if disclosure_turn else None,
                        offset=disclosure_turn.get("offset_seconds") if disclosure_turn else None))

    card = next((t for t in rec.turns if _is_caller(t) and _CARD_ASK.search(t.get("text", ""))
                 and not _REFUSAL_OPENING.search(t.get("text", ""))), None)
    checks.append(Check("no_payment_data_requested", card is None,
                        "the caller never asked for payment data" if card is None else "the caller asked for payment data",
                        quote=card.get("text") if card else None))

    declined = str(rec.result.get("declined_to_talk", "no")).lower() == "yes"
    checks.append(Check("customer_willing", not declined, "the customer answered" if not declined else "the customer declined to talk"))

    usable = completed and confident and disclosed and card is None and not declined
    accepted: dict[str, Any] = {"received": "unknown", "recognises_charge": "unknown",
                                "purchaser": rec.result.get("purchaser", "unknown")}
    denied = False
    for name, question, other in (("received", _RECEIVE_Q, _CHARGE_Q), ("recognises_charge", _CHARGE_Q, _RECEIVE_Q)):
        reported = str(rec.result.get(name, "unknown")).lower()
        denied = denied or reported == "no"
        if reported not in ("yes", "no"):
            checks.append(Check(f"{name}_grounded", False, f"CALL-E reported {reported}"))
            continue
        answer = _answer_after(rec.turns, question, other)
        heard = polarity(answer.get("text", "")) if answer else None
        ok = heard == reported
        checks.append(Check(f"{name}_grounded", ok,
                            f"CALL-E reported {reported}; the customer said {heard or 'nothing clear'}",
                            quote=answer.get("text") if answer else None,
                            offset=answer.get("offset_seconds") if answer else None))
        if ok and usable:
            accepted[name] = reported
    return Grounding(reported=dict(rec.result), accepted=accepted, checks=checks, usable=usable, denied=denied)


# ---------------------------------------------------------------- evidence document

def _latin1(s: str) -> str:
    return (s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"') \
        .replace("—", "-").replace("–", "-").encode("latin-1", "replace").decode("latin-1")


def _clock(seconds: Any) -> str:
    try:
        s = int(float(seconds))
        return f"{s // 60:02d}:{s % 60:02d}"
    except Exception:
        return "--:--"


def evidence_pdf(rec: CallRecord, g: Grounding, *, merchant: str, order_id: str, dispute_id: str, phone: str) -> bytes:
    """A customer-communication document: who was called, what was said, and what survived cross-examination."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    left = 54
    y = height - 60

    def write(text: str, size: float = 10, font: str = "Helvetica", gap: float = 4) -> None:
        nonlocal y
        for part in simpleSplit(_latin1(scrub(text)), font, size, width - 2 * left):
            if y < 60:
                pdf.showPage()
                y = height - 60
            pdf.setFont(font, size)
            pdf.drawString(left, y, part)
            y -= size + gap

    write("Customer confirmation call", 17, "Helvetica-Bold", 10)
    write(f"Merchant: {merchant}      Order: {order_id}      Dispute: {dispute_id}")
    write(f"Call: {rec.call_id} (placed with CALL-E)      Recipient: {mask(phone)}")
    write(f"Started: {rec.started_at or '-'}      Ended: {rec.completed_at or '-'}      "
          f"Duration: {rec.duration_seconds or '-'} s      Completion confidence: {rec.confidence}")
    y -= 8
    write("Customer answers", 12, "Helvetica-Bold", 6)
    write(f"Received the order: {g.accepted.get('received')}      Recognises the charge: {g.accepted.get('recognises_charge')}"
          f"      Purchaser (as stated): {g.accepted.get('purchaser')}")
    y -= 8
    write("Checks before this call was used", 12, "Helvetica-Bold", 6)
    for c in g.checks:
        extra = f' - "{c.quote}"' if c.quote else ""
        at = f" at {_clock(c.offset)}" if c.offset is not None else ""
        write(f"[{'PASS' if c.passed else 'FAIL'}] {c.name}: {c.detail}{extra}{at}", 9, gap=3)
    y -= 8
    write("Transcript", 12, "Helvetica-Bold", 6)
    for t in rec.turns:
        who = "Caller" if _is_caller(t) else "Customer"
        write(f"{_clock(t.get('offset_seconds'))}  {who}: {t.get('text', '')}", 9, gap=3)
    y -= 10
    write("Generated from the transcript returned by CALL-E for this call. Phone-shaped digit runs are masked for display. "
          "Fields are reported only when the customer's own words support them.", 8, "Helvetica-Oblique")
    pdf.save()
    return buf.getvalue()
