"""Audit/case report: the full evidence trail behind one advisory recommendation.

Real fraud-ops requirement (compliance needs to see exactly what was asked,
what was answered, which red flags fired, and why), not decoration -- and
it directly demonstrates the classifier's reasoning, which is also good for
demo clarity. Operates on the same ``{case, call, attempts, events,
signals}`` record shape as ``fixtures/*.json`` and ``synthetic_corpus.py``,
so it works identically over a fixture, a synthetic case, or a real
completed call's data assembled into that shape.

Every value that reaches the report is redacted first (``safety.redact_value``)
-- a case audit trail is exactly the kind of artifact that gets exported,
emailed, or archived, and this data is more sensitive than a generic
contact list.
"""

from __future__ import annotations

from . import decide as decide_mod
from . import resolve
from .safety import mask_phone, redact_value


_AGENT_SPEAKER = "bot"  # CALL-E's actual speaker label, confirmed during
# pre-submission validation against the live API and corroborated by the
# other apps in this repo that handle real transcripts (mobilize, leash
# both key off speaker == "user" for the recipient side, never
# "recipient"). This module originally hardcoded "agent"/"recipient" -- a
# plausible-sounding guess baked into every fixture and the synthetic
# corpus, never checked against a provider transcript -- which silently
# paired zero Q&A turns against any real call, including a fully
# successful one. Any speaker that is not the agent is treated as the
# recipient side (not a second hardcoded string) so this stays correct even
# if CALL-E's transcript ever uses a label other than "user" for the human
# side.


def _pair_questions_with_answers(transcript_turns: list[dict]) -> list[dict]:
    """Walk a transcript, pairing each agent (``speaker == "bot"``) question
    with the answer that immediately followed it (``None`` if none did --
    e.g. the account holder hung up mid-question)."""
    qa: list[dict] = []
    pending_question: str | None = None
    for turn in transcript_turns:
        speaker = turn.get("speaker")
        text = turn.get("text", "")
        if speaker == _AGENT_SPEAKER:
            if pending_question is not None:
                qa.append({"question": pending_question, "answer": None})
            pending_question = text
        elif speaker is not None and speaker != _AGENT_SPEAKER and pending_question is not None:
            qa.append({"question": pending_question, "answer": text})
            pending_question = None
    if pending_question is not None:
        qa.append({"question": pending_question, "answer": None})
    return qa


def build_audit_report(record: dict) -> dict:
    """Build the redacted audit report for one ``{case, call, attempts,
    events, signals}`` record."""
    case = record["case"]
    resolution = resolve.classify(
        record["call"], record.get("attempts", []), record.get("events", [])
    )
    disposition = decide_mod.decide(resolution, record.get("signals", {}))

    attempts = record.get("attempts") or []
    transcript_turns = (attempts[0].get("transcript_turns") if attempts else None) or []

    report = {
        "case_id": case["case_id"],
        "account_holder_name": case["account_holder_name"],
        "dialed_phone_masked": mask_phone(case["on_file_phone"]),
        "claimed_transaction_amount": case["claimed_transaction_amount"],
        "claimed_recipient": case["claimed_recipient"],
        "claimed_payment_method": case["claimed_payment_method"],
        "call_outcome": resolution.as_dict(),
        "verification_qa": _pair_questions_with_answers(transcript_turns),
        "signals": dict(record.get("signals", {})),
        "disposition": disposition.as_dict(),
    }
    return redact_value(report)


def render_terminal_report(report: dict) -> str:
    lines = [
        f"RingFence case audit -- {report['case_id']}",
        "=" * 40,
        f"Account holder     : {report['account_holder_name']}",
        f"Dialed (masked)    : {report['dialed_phone_masked']}",
        f"Claimed amount     : {report['claimed_transaction_amount']}",
        f"Claimed recipient  : {report['claimed_recipient']}",
        f"Payment method     : {report['claimed_payment_method']}",
        "",
        f"Call outcome       : {report['call_outcome']['outcome']} "
        f"(confidence: {report['call_outcome']['confidence']})",
    ]
    for evidence in report["call_outcome"]["evidence"]:
        lines.append(f"  evidence: {evidence}")

    lines.append("")
    lines.append("Verification Q&A:")
    if not report["verification_qa"]:
        lines.append("  (no conversation occurred)")
    for i, qa in enumerate(report["verification_qa"], start=1):
        lines.append(f"  {i}. Q: {qa['question']}")
        answer = qa["answer"] if qa["answer"] is not None else "(no answer recorded)"
        lines.append(f"     A: {answer}")

    lines.append("")
    lines.append("Extracted signals:")
    if not report["signals"]:
        lines.append("  (none -- no conversation occurred, or signals were not returned)")
    for key, value in report["signals"].items():
        lines.append(f"  {key}: {value}")

    lines.append("")
    lines.append(f"RECOMMENDATION: {report['disposition']['disposition']}")
    for reason in report["disposition"]["reasons"]:
        lines.append(f"  reason: {reason}")
    lines.append(
        "  ADVISORY ONLY -- requires human review before any action is taken "
        "on this transaction."
    )

    return "\n".join(lines)
