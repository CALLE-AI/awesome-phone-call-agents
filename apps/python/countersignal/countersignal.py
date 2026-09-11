"""CounterSignal: falsifiable customer-discovery calls with a frozen protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Protocol
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.heycall-e.com"
LOOPBACK_TEST_API_KEY = "loopback-test-key"
TERMINAL_SUCCESS = {"completed", "succeeded"}
RECIPIENT_SPEAKERS = {"recipient", "user", "callee"}
MIN_CONFIDENCE = 0.80
PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")


@dataclass(frozen=True)
class DecisionRule:
    min_answered: int
    support_if_at_least: int
    weaken_if_at_least: int


@dataclass(frozen=True)
class Experiment:
    experiment_id: str
    segment: str
    problem: str
    hypothesis: str
    questions: tuple[str, ...]
    decision_rule: DecisionRule


@dataclass(frozen=True)
class Recipient:
    phone: str
    region: str
    locale: str


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]: ...


def _nonempty_text(value: Any, field: str, limit: int = 600) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be non-empty text")
    text = value.strip()
    if len(text) > limit:
        raise ValueError(f"{field} exceeds {limit} characters")
    return text


def parse_experiment(data: dict[str, Any]) -> Experiment:
    if not isinstance(data, dict):
        raise ValueError("experiment must be an object")
    experiment_id = _nonempty_text(data.get("experiment_id"), "experiment_id", 80)
    segment = _nonempty_text(data.get("segment"), "segment", 240)
    problem = _nonempty_text(data.get("problem"), "problem", 300)
    hypothesis = _nonempty_text(data.get("hypothesis"), "hypothesis", 500)
    raw_questions = data.get("questions")
    if not isinstance(raw_questions, list) or not 3 <= len(raw_questions) <= 8:
        raise ValueError("questions must contain 3-8 fixed questions")
    questions = tuple(_nonempty_text(q, "question", 300) for q in raw_questions)
    if len(set(q.casefold() for q in questions)) != len(questions):
        raise ValueError("questions must be unique")

    raw_rule = data.get("decision_rule")
    if not isinstance(raw_rule, dict):
        raise ValueError("decision_rule must be an object")
    vals: dict[str, int] = {}
    for key in ("min_answered", "support_if_at_least", "weaken_if_at_least"):
        value = raw_rule.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"decision_rule.{key} must be a positive integer")
        vals[key] = value
    if vals["support_if_at_least"] > vals["min_answered"]:
        raise ValueError("support_if_at_least cannot exceed min_answered")
    if vals["weaken_if_at_least"] > vals["min_answered"]:
        raise ValueError("weaken_if_at_least cannot exceed min_answered")

    return Experiment(
        experiment_id=experiment_id,
        segment=segment,
        problem=problem,
        hypothesis=hypothesis,
        questions=questions,
        decision_rule=DecisionRule(**vals),
    )


def parse_recipient(data: dict[str, Any]) -> Recipient:
    if not isinstance(data, dict):
        raise ValueError("recipient must be an object")
    phone = _nonempty_text(data.get("phone"), "phone", 20)
    if not PHONE_RE.fullmatch(phone):
        raise ValueError("phone must be E.164")
    region = _nonempty_text(data.get("region"), "region", 8).upper()
    locale = _nonempty_text(data.get("locale"), "locale", 20)
    return Recipient(phone=phone, region=region, locale=locale)


def canonical_protocol(experiment: Experiment) -> dict[str, Any]:
    return {
        "experiment_id": experiment.experiment_id,
        "segment": experiment.segment,
        "problem": experiment.problem,
        "hypothesis": experiment.hypothesis,
        "questions": list(experiment.questions),
        "decision_rule": {
            "min_answered": experiment.decision_rule.min_answered,
            "support_if_at_least": experiment.decision_rule.support_if_at_least,
            "weaken_if_at_least": experiment.decision_rule.weaken_if_at_least,
        },
    }


def protocol_hash(experiment: Experiment) -> str:
    canonical = json.dumps(
        canonical_protocol(experiment), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode()
    return hashlib.sha256(canonical).hexdigest()


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "continued_after_ai_disclosure",
            "disposition",
            "problem_occurred",
            "current_workaround",
            "would_take_followup",
            "contradicts_hypothesis",
            "key_quote",
            "notes",
        ],
        "properties": {
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "disposition": {
                "type": "string",
                "enum": ["answered", "refused", "voicemail", "unreachable", "unclear"],
            },
            "problem_occurred": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "current_workaround": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "would_take_followup": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "contradicts_hypothesis": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "key_quote": {"type": "string", "maxLength": 300},
            "notes": {"type": "string", "maxLength": 500},
        },
        "additionalProperties": False,
    }


def build_task(experiment: Experiment, recipient: Recipient) -> str:
    numbered = " ".join(f"Q{i + 1}: {q}" for i, q in enumerate(experiment.questions))
    return (
        f"You are conducting one bounded customer-discovery interview for experiment "
        f"{experiment.experiment_id}, in locale {recipient.locale}. Identify yourself as an AI "
        "research assistant and ask whether the recipient is willing to continue with a short "
        "business-research interview. If they decline, ask to stop, or express uncertainty about "
        "participating, thank them and end the call. Do not sell, pitch, negotiate, offer a discount, "
        "ask for payment, schedule a purchase, or argue with an answer. Do not reveal the operator's "
        "hypothesis. Ask the fixed questions in order. You may ask one neutral clarification when an "
        "answer is ambiguous, but you may not introduce a new substantive question. The target segment "
        f"is: {experiment.segment}. The problem under study is: {experiment.problem}. {numbered} "
        "Return a conservative structured result. Mark voicemail, refusal, unreachable, and unclear "
        "separately. Set contradicts_hypothesis=yes only when the recipient directly gives evidence that "
        "the problem does not occur, is immaterial, or the assumed workflow is wrong. key_quote must be a "
        "short verbatim quote from the recipient that best supports the coded outcome; if no usable quote "
        "exists, use an empty string and prefer unknown/unclear fields over guessing."
    )


def call_arguments(experiment: Experiment, recipient: Recipient) -> dict[str, Any]:
    return {
        "task": build_task(experiment, recipient),
        "recipients": [{"phones": [recipient.phone], "region": recipient.region, "locale": recipient.locale}],
        "result_schema": result_schema(),
        "metadata": {
            "workflow_type": "falsifiable_customer_discovery",
            "experiment_id": experiment.experiment_id,
            "protocol_hash": protocol_hash(experiment),
        },
    }


def idempotency_key(experiment: Experiment, recipient: Recipient) -> str:
    payload = {"call": call_arguments(experiment, recipient), "recipient": recipient.phone}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return f"countersignal-{hashlib.sha256(canonical).hexdigest()}"


def confidence_score(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        score = value.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            return float(score)
    return 0.0


def valid_structured_result(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    schema = result_schema()
    required = schema["required"]
    if set(value) != set(required):
        return False
    for field in required:
        item = value[field]
        rule = schema["properties"][field]
        if not isinstance(item, str):
            return False
        if len(item) > rule.get("maxLength", 10_000):
            return False
        if "enum" in rule and item not in rule["enum"]:
            return False
    return True


def recipient_transcript(provider_result: dict[str, Any], destination: str) -> str:
    recipients = provider_result.get("recipients")
    if not isinstance(recipients, list) or len(recipients) != 1:
        return ""
    recipient = recipients[0]
    if not isinstance(recipient, dict) or recipient.get("phone") != destination:
        return ""
    attempts = recipient.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        return ""
    turns: list[str] = []
    for attempt in attempts:
        if not isinstance(attempt, dict):
            continue
        transcript_turns = attempt.get("transcript_turns")
        if not isinstance(transcript_turns, list):
            continue
        for turn in transcript_turns:
            if (
                isinstance(turn, dict)
                and str(turn.get("speaker", "")).lower() in RECIPIENT_SPEAKERS
                and isinstance(turn.get("text"), str)
            ):
                turns.append(turn["text"])
    return "\n".join(turns)


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.casefold())


def quote_grounded(quote: Any, transcript: str) -> bool:
    if not isinstance(quote, str) or not quote.strip():
        return False
    expected = _tokens(quote)
    observed = _tokens(transcript)
    if len(expected) < 2:
        return False
    width = len(expected)
    return any(observed[i : i + width] == expected for i in range(len(observed) - width + 1))


def _binding_valid(
    experiment: Experiment,
    recipient: Recipient,
    provider_result: dict[str, Any],
    expected_call_id: str | None,
) -> bool:
    if expected_call_id is not None and provider_result.get("id") != expected_call_id:
        return False
    if provider_result.get("metadata") != {
        "workflow_type": "falsifiable_customer_discovery",
        "experiment_id": experiment.experiment_id,
        "protocol_hash": protocol_hash(experiment),
    }:
        return False
    transcript = recipient_transcript(provider_result, recipient.phone)
    structured = provider_result.get("structured_result")
    return isinstance(structured, dict) and quote_grounded(structured.get("key_quote"), transcript)


def classify_call(
    experiment: Experiment,
    recipient: Recipient,
    provider_result: dict[str, Any],
    *,
    expected_call_id: str | None = None,
) -> dict[str, str]:
    structured = provider_result.get("structured_result")
    if (
        provider_result.get("status") not in TERMINAL_SUCCESS
        or provider_result.get("task_completed") is not True
        or confidence_score(provider_result.get("completion_confidence")) < MIN_CONFIDENCE
        or not valid_structured_result(structured)
    ):
        return {"bucket": "invalid", "reason": "No reliable complete terminal result."}
    assert isinstance(structured, dict)
    if structured["disposition"] != "answered" or structured["continued_after_ai_disclosure"] != "yes":
        return {"bucket": "nonresponse", "reason": f"Disposition is {structured['disposition']}."}
    if not _binding_valid(experiment, recipient, provider_result, expected_call_id):
        return {"bucket": "invalid", "reason": "Result was not bound to the frozen protocol and recipient evidence."}
    if structured["contradicts_hypothesis"] == "yes" or structured["problem_occurred"] == "no":
        return {"bucket": "disconfirming", "reason": "Recipient directly contradicted a load-bearing hypothesis condition."}
    if structured["problem_occurred"] == "yes" and structured["current_workaround"] == "yes":
        return {"bucket": "supporting", "reason": "Recipient reported the problem and an existing workaround."}
    return {"bucket": "neutral", "reason": "Answered interview did not meet support or disconfirmation rule."}


def experiment_decision(experiment: Experiment, buckets: Iterable[str]) -> dict[str, Any]:
    counts = {name: 0 for name in ("supporting", "disconfirming", "neutral", "nonresponse", "invalid")}
    for bucket in buckets:
        if bucket not in counts:
            raise ValueError(f"unknown bucket: {bucket}")
        counts[bucket] += 1
    answered = counts["supporting"] + counts["disconfirming"] + counts["neutral"]
    rule = experiment.decision_rule
    if answered < rule.min_answered:
        decision = "collect_more"
    elif counts["disconfirming"] >= rule.weaken_if_at_least:
        decision = "hypothesis_weakened"
    elif counts["supporting"] >= rule.support_if_at_least and counts["disconfirming"] == 0:
        decision = "hypothesis_supported_under_rule"
    else:
        decision = "inconclusive"
    return {
        "decision": decision,
        "answered_denominator": answered,
        "counts": counts,
        "rule": {
            "min_answered": rule.min_answered,
            "support_if_at_least": rule.support_if_at_least,
            "weaken_if_at_least": rule.weaken_if_at_least,
        },
        "claim_boundary": "This is a pre-registered operational rule, not a population-level statistical estimate.",
    }


def _is_loopback_base_url(value: str) -> bool:
    parsed = urlparse(value)
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port is not None
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    )


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.heycall-e.com"
        and parsed.port in {None, 443}
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return DEFAULT_BASE_URL
    if _is_loopback_base_url(value):
        return value.rstrip("/")
    raise ValueError("base URL must be CALL-E production or an explicit loopback test server")


def api_key_for_base_url(base_url: str) -> str:
    """Use a non-secret credential for local fakes; require a real key in production."""
    if _is_loopback_base_url(base_url):
        return LOOPBACK_TEST_API_KEY
    key = os.environ.get("CALLE_API_KEY", "").strip()
    if not key:
        raise ValueError("CALLE_API_KEY is required for production --execute")
    return key


class ReservationLedger:
    """Durable one-intent/one-call reservation for consequential real-call retries."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS calls "
                "(key TEXT PRIMARY KEY, state TEXT NOT NULL, call_id TEXT, detail TEXT)"
            )

    def claim(self, key: str) -> bool:
        try:
            with sqlite3.connect(self.path) as db:
                db.execute("INSERT INTO calls(key, state) VALUES (?, 'reserved')", (key,))
            return True
        except sqlite3.IntegrityError:
            return False

    def mark(
        self, key: str, state: str, call_id: str | None = None, detail: str | None = None
    ) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "UPDATE calls SET state=?, call_id=COALESCE(?, call_id), detail=? WHERE key=?",
                (state, call_id, detail, key),
            )

    def get(self, key: str) -> tuple[str, str | None, str | None] | None:
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT state, call_id, detail FROM calls WHERE key=?", (key,)
            ).fetchone()
        return row if row else None


def execute(
    experiment: Experiment,
    recipient: Recipient,
    calls: CallsAPI,
    ledger: ReservationLedger,
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    key = idempotency_key(experiment, recipient)
    if not ledger.claim(key):
        state = ledger.get(key)
        raise RuntimeError(
            f"call already reserved; reconcile existing state {state[0] if state else 'unknown'}"
        )
    accepted_call_id: str | None = None
    try:
        created = calls.create(
            **call_arguments(experiment, recipient),
            idempotency_key=key,
        )
        call_id = created.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise RuntimeError("CALL-E create response did not contain a call id")
        accepted_call_id = call_id
        ledger.mark(key, "accepted", call_id)
        completed = calls.wait_for_result(
            call_id, timeout_seconds=timeout_seconds, interval_seconds=2
        )
        result = {
            "call_id": call_id,
            "classification": classify_call(
                experiment, recipient, completed, expected_call_id=call_id
            ),
            "provider_result": completed,
        }
        ledger.mark(key, "completed", call_id)
        return result
    except Exception as exc:
        ledger.mark(key, "outcome_unknown", accepted_call_id, type(exc).__name__)
        raise RuntimeError(
            "CALL-E outcome is unknown; reconcile the existing reservation before any retry"
        ) from exc


def mask_phone(phone: str) -> str:
    if len(phone) <= 6:
        return "*" * len(phone)
    return f"{phone[:2]}{'*' * (len(phone) - 6)}{phone[-4:]}"


def preview(experiment: Experiment, recipient: Recipient) -> dict[str, Any]:
    args = call_arguments(experiment, recipient)
    args["recipients"] = [{"phones": [mask_phone(recipient.phone)], "region": recipient.region, "locale": recipient.locale}]
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "protocol_hash": protocol_hash(experiment),
        "idempotency_key": idempotency_key(experiment, recipient),
        "call_arguments": args,
    }


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--recipient", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-one-reviewed-recipient", action="store_true")
    parser.add_argument("--allow", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--database", type=Path, default=Path("data/countersignal.sqlite3"))
    args = parser.parse_args(argv)
    try:
        experiment = parse_experiment(_load(args.experiment))
        recipient = parse_recipient(_load(args.recipient))
        if not args.execute:
            print(json.dumps(preview(experiment, recipient), ensure_ascii=False, indent=2))
            return 0
        if not args.confirm_one_reviewed_recipient:
            raise ValueError("--execute requires --confirm-one-reviewed-recipient")
        if recipient.phone not in set(args.allow):
            raise ValueError("--execute requires the exact recipient phone in --allow")
        if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() != "true":
            raise ValueError("--execute requires CALLE_LIVE_CALLS_ENABLED=true")
        base_url = validate_base_url(os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL))
        key = api_key_for_base_url(base_url)
        from calle import CalleClient

        with CalleClient(api_key=key, base_url=base_url) as client:
            payload = execute(
                experiment, recipient, client.calls, ReservationLedger(args.database), args.timeout_seconds
            )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
