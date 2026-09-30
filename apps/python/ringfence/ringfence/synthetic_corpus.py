"""Exhaustive combinatorial synthetic corpus for the measured-evaluation report.

Not committed as JSON files (unlike `fixtures/`, which stays a small, curated
corpus with a narrative `_evidence_source` per case). This module generates
its corpus in memory, exhaustively enumerating the decision-relevant state
space `decide()` actually branches on:

- all 2**5 = 32 combinations of the five boolean verification-call signals,
  crossed with both outcomes where a real conversation occurred
  (`answered_success`, `answered_declined`) -- 64 cases,
- one case per documented ambiguity marker in `resolve._POLICY_REFUSAL_MARKERS`
  and `resolve._MALFORMED_DESTINATION_MARKERS`, proving each marker string
  actually resolves to its intended outcome rather than just the handful a
  hand-picked fixture happened to use,
- a handful of no-conversation variants (no_answer_confirmed,
  rejected_before_ring, unresolved_ambiguous) with different raw call shapes,
- 2 naive-trap cases (call-level flags claim success, attempt trail
  disagrees) and 3 connection_failed_during_attempt cases -- the outcome
  category added after pre-submission validation against the live API
  exposed that resolve.classify() mislabeled a zero-ring-time connection
  failure as a confirmed no-answer.

This is exhaustive-over-branches, not a random sample: reproducible with
`python -m ringfence.evaluation`, costs nothing (no live calls), and every
case's `expected_disposition` is computed by `oracle_disposition()` below --
an independently written re-implementation of decide.py's table, not a call
into decide.py itself, so the cross-check in tests/test_synthetic_corpus.py
is a real second opinion, not the module grading its own homework.
"""

from __future__ import annotations

import itertools
from typing import Iterable

from . import resolve

SIGNAL_KEYS = (
    "secrecy_demand_present",
    "urgency_pressure_present",
    "relationship_explained",
    "irreversible_payment_demanded",
    "explicit_hold_requested",
)

_PAYMENT_METHODS = ("wire", "ach_transfer", "check", "zelle", "venmo")
_AMOUNTS = ("850.00", "2400.00", "9999.00", "42000.00", "150.00")


def oracle_disposition(outcome: str, signals: dict) -> str:
    """Independent re-implementation of decide.py's table, for cross-check.

    Deliberately not a call into decide.decide() -- written separately from
    RINGFENCE-BUILD-SPEC.md's table so agreement between the two is a real
    second opinion.
    """
    if signals.get("explicit_hold_requested") is True:
        return "ADVISE_BLOCK"
    if (
        signals.get("secrecy_demand_present") is True
        or signals.get("urgency_pressure_present") is True
        or signals.get("relationship_explained") is False
        or signals.get("irreversible_payment_demanded") is True
    ):
        return "ADVISE_BLOCK"
    if (
        outcome == resolve.ANSWERED_SUCCESS
        and signals.get("secrecy_demand_present") is False
        and signals.get("urgency_pressure_present") is False
        and signals.get("relationship_explained") is True
        and signals.get("irreversible_payment_demanded") is False
        and signals.get("explicit_hold_requested") is False
    ):
        return "ADVISE_ALLOW"
    return "ESCALATE_TO_HUMAN"


def _signal_combo_dicts() -> Iterable[dict]:
    for combo in itertools.product([True, False], repeat=len(SIGNAL_KEYS)):
        yield dict(zip(SIGNAL_KEYS, combo))


def _transcript_for(signals: dict, declined: bool) -> list[dict]:
    turns = [
        {"speaker": "bot", "text": "This is an automated verification call about a flagged transaction. Did anyone ask you to keep this confidential, or not to tell your bank?"},
        {"speaker": "user", "text": "Yes, I was told to keep it secret." if signals["secrecy_demand_present"] else "No, nobody asked me to keep anything secret."},
        {"speaker": "bot", "text": "Is there time pressure to complete this payment?"},
        {"speaker": "user", "text": "Yes, it has to happen immediately." if signals["urgency_pressure_present"] else "No, there's no rush."},
        {"speaker": "bot", "text": "Can you describe your relationship to the recipient and why you're sending this payment?"},
        {"speaker": "user", "text": "It's a vendor I've dealt with before." if signals["relationship_explained"] else "I'm not really sure who they are."},
        {"speaker": "bot", "text": "Is this payment reversible if it turns out to be a mistake?"},
        {"speaker": "user", "text": "No, once it's sent it's gone." if signals["irreversible_payment_demanded"] else "Yes, it can be reversed or disputed."},
        {"speaker": "bot", "text": "Would you like to place a hold on this transaction?"},
        {"speaker": "user", "text": "Yes, please hold it." if signals["explicit_hold_requested"] else "No hold needed, go ahead."},
    ]
    if declined:
        turns.append({"speaker": "user", "text": "Actually, I don't want to continue this call."})
    return turns


def _conversation_case(idx: int, signals: dict, declined: bool) -> dict:
    label = "declined" if declined else "success"
    case_id = f"gen_{label}_{idx:02d}"
    phone = f"+141555{idx:05d}"
    method = _PAYMENT_METHODS[idx % len(_PAYMENT_METHODS)]
    amount = _AMOUNTS[idx % len(_AMOUNTS)]
    outcome = resolve.ANSWERED_DECLINED if declined else resolve.ANSWERED_SUCCESS

    call = {
        "id": f"call_{case_id}",
        "status": "completed",
        "task": f"Verify a flagged {amount} {method} transaction.",
        "failure_code": None,
        "failure_message": None,
        "task_completed": not declined,
        "completion_confidence": {"score": 0.4 if declined else 0.9, "label": "low" if declined else "high"},
        "summary": "Synthetic combinatorial signal-space case.",
    }
    attempts = [{
        "id": f"attempt_{case_id}",
        "phone": phone,
        "status": "completed",
        "started_at": "2026-09-10T00:00:00Z",
        "completed_at": "2026-09-10T00:03:00Z",
        "summary": "Synthetic combinatorial signal-space case.",
        "transcript_turns": _transcript_for(signals, declined),
        "provider_call_id": f"prov_{case_id}",
        "failure_code": None,
        "failure_message": None,
    }]
    events = [
        {"id": f"evt_{case_id}a", "type": "call.dialing", "call_id": f"call_{case_id}", "created_at": "2026-09-10T00:00:00Z", "level": "info", "status": "in_progress", "message": "Dialing account holder.", "details": {"region": "US"}},
        {"id": f"evt_{case_id}b", "type": "call.completed", "call_id": f"call_{case_id}", "created_at": "2026-09-10T00:03:00Z", "level": "info", "status": "completed", "message": "Call completed.", "details": {"region": "US", "locale": "en-US"}},
    ]

    return {
        "_evidence_source": f"generated: exhaustive signal-combination case #{idx} ({outcome}), see ringfence/synthetic_corpus.py",
        "category": "generated_signal_combination",
        "case": {
            "case_id": case_id,
            "account_holder_name": "Synthetic Holder",
            "on_file_phone": phone,
            "claimed_transaction_amount": amount,
            "claimed_recipient": "Synthetic Recipient",
            "claimed_payment_method": method,
            "request_supplied_callback_number": None,
        },
        "call": call,
        "attempts": attempts,
        "events": events,
        "signals": signals,
        "expected_disposition": oracle_disposition(outcome, signals),
    }


def _no_conversation_case(
    idx: int,
    outcome: str,
    *,
    status: str,
    failure_message: str | None,
    with_no_answer_attempt: bool,
    task_completed=None,
) -> dict:
    case_id = f"gen_{outcome}_{idx:02d}"
    phone = f"+141556{idx:05d}"
    call = {
        "id": f"call_{case_id}",
        "status": status,
        "task": "Verify a flagged transaction.",
        "failure_code": None,
        "failure_message": failure_message,
        "task_completed": task_completed,
        "completion_confidence": {"score": 0.0, "label": "low"},
        "summary": "Synthetic no-conversation case.",
    }
    attempts: list[dict] = []
    if with_no_answer_attempt:
        attempts = [{
            "id": f"attempt_{case_id}",
            "phone": phone,
            "status": "completed",
            "started_at": "2026-09-10T00:00:00Z",
            "completed_at": "2026-09-10T00:00:45Z",
            "summary": "No engagement.",
            "transcript_turns": [],
            "provider_call_id": f"prov_{case_id}",
            "failure_code": None,
            "failure_message": None,
        }]
    events = [{
        "id": f"evt_{case_id}",
        "type": "call.failed" if status in ("failed", "canceled") else "call.completed",
        "call_id": f"call_{case_id}",
        "created_at": "2026-09-10T00:00:00Z",
        "level": "warning",
        "status": status,
        "message": failure_message or "",
        "details": {},
    }]
    return {
        "_evidence_source": f"generated: no-conversation case #{idx} ({outcome}), see ringfence/synthetic_corpus.py",
        "category": "generated_no_conversation",
        "case": {
            "case_id": case_id,
            "account_holder_name": "Synthetic Holder",
            "on_file_phone": phone,
            "claimed_transaction_amount": "500.00",
            "claimed_recipient": "Synthetic Recipient",
            "claimed_payment_method": "ach_transfer",
            "request_supplied_callback_number": None,
        },
        "call": call,
        "attempts": attempts,
        "events": events,
        "signals": {},
        "expected_disposition": oracle_disposition(outcome, {}),
    }


def _naive_trap_case(idx: int, *, never_dialed: bool) -> dict:
    """A call whose top-level `status`/`task_completed` claim success while
    the attempt trail disagrees -- exactly the ambiguity CALL-E's own
    errors.mdx warns integrations not to trust. Signals are explicitly
    clean, so if `decide()` ever trusted the top-level flags the way
    `naive_classify()` does, this would wrongly `ADVISE_ALLOW`. It doesn't: `decide()`
    always goes through `resolve.classify()`, which cross-references the
    attempt trail and returns `unresolved_ambiguous`/`no_answer_confirmed`,
    forcing `ESCALATE_TO_HUMAN`. See test_naive_vs_resolve_comparison_finds_
    real_unsafe_disagreements in tests/test_synthetic_corpus.py.
    """
    case_id = f"gen_naive_trap_{idx:02d}"
    phone = f"+141557{idx:05d}"
    clean_signals = {
        "secrecy_demand_present": False,
        "urgency_pressure_present": False,
        "relationship_explained": True,
        "irreversible_payment_demanded": False,
        "explicit_hold_requested": False,
    }
    call = {
        "id": f"call_{case_id}",
        "status": "completed",
        "task": "Verify a flagged transaction.",
        "failure_code": None,
        "failure_message": None,
        "task_completed": True,
        "completion_confidence": {"score": 0.85, "label": "high"},
        "summary": "Call-level fields claim success; the attempt trail disagrees (synthetic CALL-E ambiguity trap).",
    }
    attempts: list[dict] = []
    if not never_dialed:
        attempts = [{
            "id": f"attempt_{case_id}",
            "phone": phone,
            "status": "completed",
            "started_at": "2026-09-10T00:00:00Z",
            "completed_at": "2026-09-10T00:00:45Z",
            "summary": "No engagement, despite the call-level task_completed=True.",
            "transcript_turns": [],
            "provider_call_id": f"prov_{case_id}",
            "failure_code": None,
            "failure_message": None,
        }]
    events = [{
        "id": f"evt_{case_id}", "type": "call.completed", "call_id": f"call_{case_id}",
        "created_at": "2026-09-10T00:00:45Z", "level": "info", "status": "completed",
        "message": "Call marked completed.", "details": {},
    }]
    real_outcome = resolve.classify(call, attempts, events).outcome
    return {
        "_evidence_source": (
            f"generated: naive-trap case #{idx} (call-level status/task_completed claim success, "
            "attempt trail disagrees) -- the exact ambiguity CALL-E's errors.mdx warns integrations "
            "not to trust, see ringfence/synthetic_corpus.py"
        ),
        "category": "generated_naive_trap",
        "case": {
            "case_id": case_id,
            "account_holder_name": "Synthetic Holder",
            "on_file_phone": phone,
            "claimed_transaction_amount": "500.00",
            "claimed_recipient": "Synthetic Recipient",
            "claimed_payment_method": "ach_transfer",
            "request_supplied_callback_number": None,
        },
        "call": call,
        "attempts": attempts,
        "events": events,
        "signals": clean_signals,
        "expected_disposition": oracle_disposition(real_outcome, clean_signals),
    }


def _connection_failed_case(idx: int, *, zero_duration: bool, attempt_failure_code: str | None) -> dict:
    """Models the provider failure shape that exposed a real classifier
    bug: an attempt whose started_at == completed_at, carrying an
    attempt-level failure_code -- resolve.classify() used to mislabel this
    no_answer_confirmed. See tests/test_resolve.py.
    """
    case_id = f"gen_connfail_{idx:02d}"
    phone = f"+141558{idx:05d}"
    started_at = "2026-09-10T00:00:00Z"
    completed_at = started_at if zero_duration else "2026-09-10T00:00:10Z"
    call = {
        "id": f"call_{case_id}",
        "status": "failed",
        "task": "Verify a flagged transaction.",
        "failure_code": "call_failed" if attempt_failure_code else None,
        "failure_message": None,
        "task_completed": False,
        "completion_confidence": {"score": 0.3, "label": "low"},
        "summary": "Synthetic connection-failure-during-attempt case.",
    }
    attempts = [{
        "id": f"attempt_{case_id}",
        "phone": phone,
        "status": "failed",
        "started_at": started_at,
        "completed_at": completed_at,
        "summary": "Connection failed during the attempt.",
        "transcript_turns": [],
        "provider_call_id": f"prov_{case_id}",
        "failure_code": attempt_failure_code,
        "failure_message": None,
    }]
    events = [{
        "id": f"evt_{case_id}", "type": "call.failed", "call_id": f"call_{case_id}",
        "created_at": completed_at, "level": "warning", "status": "failed",
        "message": "Attempt failed to connect.", "details": {},
    }]
    return {
        "_evidence_source": (
            f"generated: connection-failed-during-attempt case #{idx} "
            f"(zero_duration={zero_duration}, attempt_failure_code={attempt_failure_code!r}), "
            "modeled on the provider failure shape seen against the live API"
        ),
        "category": "generated_no_conversation",
        "case": {
            "case_id": case_id,
            "account_holder_name": "Synthetic Holder",
            "on_file_phone": phone,
            "claimed_transaction_amount": "500.00",
            "claimed_recipient": "Synthetic Recipient",
            "claimed_payment_method": "ach_transfer",
            "request_supplied_callback_number": None,
        },
        "call": call,
        "attempts": attempts,
        "events": events,
        "signals": {},
        "expected_disposition": oracle_disposition(resolve.CONNECTION_FAILED_DURING_ATTEMPT, {}),
    }


def generate_corpus() -> list[dict]:
    records: list[dict] = []

    for idx, signals in enumerate(_signal_combo_dicts()):
        records.append(_conversation_case(idx, signals, declined=False))
    for idx, signals in enumerate(_signal_combo_dicts()):
        records.append(_conversation_case(idx, signals, declined=True))

    for idx, marker in enumerate(resolve._POLICY_REFUSAL_MARKERS):
        records.append(_no_conversation_case(
            idx, resolve.POLICY_OR_CONTENT_REFUSAL, status="failed",
            failure_message=f"Call refused: message referenced {marker}.",
            with_no_answer_attempt=False,
        ))
    for idx, marker in enumerate(resolve._MALFORMED_DESTINATION_MARKERS):
        records.append(_no_conversation_case(
            idx, resolve.MALFORMED_OR_UNSUPPORTED_DESTINATION, status="failed",
            failure_message=f"Call could not be placed: {marker}.",
            with_no_answer_attempt=False,
        ))
    for idx in range(3):
        records.append(_no_conversation_case(
            idx, resolve.REJECTED_BEFORE_RING, status="canceled",
            failure_message=f"Unspecified provider error #{idx}.",
            with_no_answer_attempt=False,
        ))
    for idx in range(3):
        records.append(_no_conversation_case(
            idx, resolve.NO_ANSWER_CONFIRMED, status="completed",
            failure_message=None, with_no_answer_attempt=True, task_completed=False,
        ))
    for idx, status in enumerate(("queued", "unknown", None)):
        records.append(_no_conversation_case(
            idx, resolve.UNRESOLVED_AMBIGUOUS, status=status,
            failure_message=None, with_no_answer_attempt=False, task_completed=None,
        ))

    records.append(_naive_trap_case(0, never_dialed=True))
    records.append(_naive_trap_case(1, never_dialed=False))

    records.append(_connection_failed_case(0, zero_duration=True, attempt_failure_code="404"))
    records.append(_connection_failed_case(1, zero_duration=True, attempt_failure_code=None))
    records.append(_connection_failed_case(2, zero_duration=False, attempt_failure_code="503"))

    return records
