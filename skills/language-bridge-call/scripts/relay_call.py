#!/usr/bin/env python3
"""Language bridge relay: at most two CALL-E calls, fail-closed structured result.

Modes (default is preview; nothing dials unless --execute --confirm-consent):
  preview  validate the request, print masked parties, both goal scripts, live commands
  --fixture replay the full relay state machine on canned CLI envelopes (no network)
  --execute run the relay through the CALL-E CLI (requires auth)

Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
TERMINAL_STATUSES = {
    "BUSY", "CANCELED", "CANCELLED", "COMPLETED", "DECLINED",
    "EXPIRED", "FAILED", "NO_ANSWER", "VOICEMAIL",
}
MAX_WINDOWS = 4
POLL_INTERVAL_SECONDS = 15
DEFAULT_POLL_TIMEOUT_SECONDS = 300
MIN_CONFIDENCE = 0.7
SECRET_KEYS = {"confirm_token", "access_token", "refresh_token", "session_secret"}
# Structured-answer contract bound before any downstream call. Required keys must be
# present with exactly the listed type; optional string keys must be strings if present.
ANSWER_TYPES = {
    "understood": bool, "consent_given": bool, "wrong_person": bool,
    "confidence": float, "choice": str, "counter_window": str, "notes": str,
}
# consent_given presence is enforced by the value gate in recipient_usable (missing = no_consent).
REQUIRED_ANSWER_KEYS = ("understood", "wrong_person", "confidence")
STATE_DIR_ENV = "LANGUAGE_BRIDGE_CALL_STATE_DIR"


def state_dir() -> Path:
    return Path(os.environ.get(STATE_DIR_ENV, Path.home() / ".cache" / "language-bridge-call"))


def state_path(request_id: str) -> Path:
    # sha256: filename-safe and collision-free for arbitrary request_id strings.
    return state_dir() / (hashlib.sha256(request_id.encode("utf-8")).hexdigest() + ".json")


def read_state(request_id: str) -> dict | None:
    path = state_path(request_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"status": "unreadable"}  # corrupted state: refuse rather than risk a duplicate relay


def write_state(request_id: str, payload: dict) -> None:
    path = state_path(request_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"request_id": request_id, **payload}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _type_ok(value, expected) -> bool:
    if expected is bool:
        return isinstance(value, bool)  # bool is an int subclass; reject ints masquerading
    if expected is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, str)


def validate_answer_schema(answer: dict, call: dict) -> bool:
    """Type-bind the recipient's structured answer; any violation fails closed as schema_drift."""
    for key in REQUIRED_ANSWER_KEYS:
        if not _type_ok(answer.get(key), ANSWER_TYPES[key]):
            call["disposition"] = "schema_drift"
            call["detail"] = f"answer.{key} is missing or not {ANSWER_TYPES[key].__name__}"
            return False
    if not 0.0 <= float(answer["confidence"]) <= 1.0:
        call["disposition"] = "schema_drift"
        call["detail"] = "answer.confidence outside [0, 1]"
        return False
    for key in ANSWER_TYPES:
        if key not in REQUIRED_ANSWER_KEYS and key in answer and not _type_ok(answer[key], ANSWER_TYPES[key]):
            call["disposition"] = "schema_drift"
            call["detail"] = f"answer.{key} must be a string"
            return False
    return True


def mask_phone(phone: str) -> str:
    return phone[:4] + "••••" + phone[-4:] if len(phone) >= 8 else "••••"


def scrub(obj):
    if isinstance(obj, dict):
        return {k: ("***" if k in SECRET_KEYS else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


class RequestError(ValueError):
    pass


def load_request(path: str) -> dict:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RequestError("request JSON must be an object")
    for key in ("request_id", "topic", "message_to_recipient", "timezone", "authorized_reason"):
        if not str(raw.get(key, "")).strip():
            raise RequestError(f"missing required field: {key}")
    if raw.get("consent") is not True:
        raise RequestError("consent must be true")
    if raw.get("do_not_call"):
        raise RequestError("do_not_call is set; refusing")
    for party in ("requester", "recipient"):
        block = raw.get(party)
        if not isinstance(block, dict):
            raise RequestError(f"missing party block: {party}")
        for key in ("first_name", "phone", "language", "region"):
            if not str(block.get(key, "")).strip():
                raise RequestError(f"missing {party}.{key}")
        if not E164_RE.match(block["phone"]):
            raise RequestError(f"{party}.phone is not E.164: masked")
        if party == "requester" and not str(block.get("display_name", "")).strip():
            raise RequestError("missing requester.display_name")
    if raw["requester"]["phone"] == raw["recipient"]["phone"]:
        raise RequestError("requester and recipient phones must differ")
    windows = raw.get("proposed_windows", [])
    if len(windows) > MAX_WINDOWS:
        raise RequestError(f"proposed_windows must have at most {MAX_WINDOWS} entries")
    parsed_windows = []
    for window in windows:
        moment = datetime.fromisoformat(window)
        if moment.tzinfo is None:
            raise RequestError("proposed_windows entries need an explicit UTC offset")
        parsed_windows.append(moment)
    if len(set(windows)) != len(windows):
        raise RequestError("proposed_windows contains duplicates")
    raw["_windows"] = list(zip(windows, parsed_windows))
    return raw


def goal_for_recipient(req: dict) -> str:
    lines = [
        f"You are an AI phone assistant working for {req['requester']['display_name']}, "
        f"a {req['requester']['role']}.",
        "Disclose immediately that you are an AI assistant and that this is one coordination "
        f"call about {req['topic']}.",
        f"Speak {req['recipient']['language']} throughout. If the person who answers is not "
        f"{req['recipient']['first_name']}, apologize and end the call.",
        "",
        "Purpose: relay this request and capture an answer.",
        f"Message: {req['message_to_recipient']}",
    ]
    if req.get("proposed_windows"):
        lines.append("Offer only these windows, one at a time: " + ", ".join(req["proposed_windows"]) + ".")
    lines += [
        f"Ask {req['recipient']['first_name']} to choose a window, propose a different time, or decline.",
        "Do not discuss payments, contracts, deposits, or legal matters. Do not promise anything.",
        "Close politely once you have captured the answer.",
        "Before closing, record the answer as JSON with exactly these fields: understood (boolean), "
        "consent_given (boolean), wrong_person (boolean), confidence (number between 0 and 1), "
        "choice (one of the offered windows, or an empty string), "
        "counter_window (ISO-8601 time with UTC offset, or an empty string), "
        "notes (one short sentence quoting the person, in their language).",
    ]
    return "\n".join(lines)


def goal_for_requester(req: dict, answer: dict) -> str:
    choice = answer.get("choice") or answer.get("counter_window") or ""
    summary = {
        "understood": answer.get("understood"),
        "agreed_to_request": bool(choice),
        "chosen_or_proposed_time": choice,
        "notes": answer.get("notes", ""),
    }
    return "\n".join([
        f"You are an AI phone assistant calling {req['requester']['first_name']} back about {req['topic']}.",
        "Disclose immediately that you are an AI assistant.",
        f"Speak {req['requester']['language']} throughout.",
        "",
        "Relay the recipient's answer exactly: " + json.dumps(summary, ensure_ascii=False),
        "If they agreed to a time, read it back and ask the requester to accept it.",
        "If they proposed a different time or declined, relay that without negotiation.",
        "Capture accept, decline, or next instruction. Do not commit to anything beyond relaying.",
        "Record the outcome as JSON with exactly these fields: accepted (boolean), "
        "agreed_window (one of the offered windows, or an empty string), notes (one short sentence).",
    ])


def envelope_structured(raw: dict) -> dict:
    """Read the actionable object from a CLI JSON envelope (structuredContent or text fallback)."""
    result = raw.get("result")
    if isinstance(result, dict):
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        for block in result.get("content", []):
            if isinstance(block, dict) and block.get("type") == "text":
                try:
                    parsed = json.loads(block["text"])
                    if isinstance(parsed, dict):
                        return parsed
                except (ValueError, TypeError):
                    continue
    return {}


class PreviewRunner:
    def run(self, step: str, cmd: list[str]) -> dict:
        raise RuntimeError("preview mode never invokes the CLI")


class FixtureRunner:
    def __init__(self, canned: dict):
        self.canned = canned

    def run(self, step: str, cmd: list[str]) -> dict:
        if step not in self.canned:
            raise RuntimeError(f"fixture is missing canned output for step: {step}")
        return self.canned[step]


class CliRunner:
    def run(self, step: str, cmd: list[str]) -> dict:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if done.returncode != 0:
            raise RuntimeError(f"CLI step {step} failed (exit {done.returncode}): {done.stderr.strip()[:400]}")
        return json.loads(done.stdout)


def plan_and_run(runner, req: dict, party_key: str, goal: str, step_prefix: str) -> dict:
    """plan -> run -> status for one party. Returns {disposition, run_id, answer, detail}."""
    base = ["calle", "call"]
    tz = req["timezone"]
    plan_cmd = base + ["plan", "--to-phone", req[party_key]["phone"],
                       "--goal", goal, "--timezone", tz,
                       "--language", req[party_key]["language"],
                       "--region", req[party_key]["region"]]
    plan = envelope_structured(runner.run(f"{step_prefix}_plan", plan_cmd))
    if not plan.get("plan_id") or not plan.get("ready_to_run") or not plan.get("confirm_token"):
        question = plan.get("clarification_question") or plan.get("clarifications") or ""
        return {"disposition": "schema_drift", "run_id": None, "answer": {},
                "detail": f"plan not ready: {str(question)[:300]}"}
    run = runner.run(f"{step_prefix}_run", base + [
        "run", "--plan-id", plan["plan_id"], "--confirm-token", plan["confirm_token"]])
    error = run.get("error") if isinstance(run.get("error"), dict) else {}
    if error or run.get("ok") is not True:
        if run.get("call_started") == "unknown" and run.get("recovery_id"):
            return {"disposition": "needs_recovery", "run_id": None, "answer": {},
                    "detail": run.get("next_command") or f"calle call recover --recovery-id {run['recovery_id']}"}
        if run.get("call_started") is False:
            return {"disposition": "schema_drift", "run_id": None, "answer": {},
                    "detail": str(error.get("message") or "run_call refused")[:300]}
    run_id = run.get("run_id") or (run.get("status_result") or {}).get("run_id")
    if not run_id:
        return {"disposition": "schema_drift", "run_id": None, "answer": {},
                "detail": "no run_id returned"}
    return poll_status(runner, f"{step_prefix}_status", base + ["status", "--run-id", run_id, "--timezone", tz], run_id)


def poll_status(runner, step: str, cmd: list[str], run_id: str,
                poll_timeout_seconds: int = DEFAULT_POLL_TIMEOUT_SECONDS) -> dict:
    deadline = datetime.now() + timedelta(seconds=poll_timeout_seconds)
    while True:
        envelope = runner.run(step, cmd)
        run_obj = (envelope.get("status_result") or {}).get("structuredContent") or envelope_structured(envelope)
        status = str(run_obj.get("status", "")).upper()
        if status in TERMINAL_STATUSES:
            return finish_call(status, run_obj, run_id)
        if isinstance(runner, FixtureRunner):
            return finish_call("SCHEMA_DRIFT", {}, run_id)
        if datetime.now() >= deadline:
            return {"disposition": "schema_drift", "run_id": run_id, "answer": {},
                    "detail": f"status poll timed out at {poll_timeout_seconds}s (last status: {status or 'unknown'})"}
        time.sleep(POLL_INTERVAL_SECONDS)


def finish_call(status: str, run_obj: dict, run_id: str) -> dict:
    if status != "COMPLETED":
        return {"disposition": status.lower(), "run_id": run_id, "answer": {},
                "detail": f"call ended with status {status}"}
    answer = (run_obj.get("structured_output") if isinstance(run_obj.get("structured_output"), dict)
              else run_obj.get("result") if isinstance(run_obj.get("result"), dict) else {})
    if not answer:
        return {"disposition": "schema_drift", "run_id": run_id, "answer": {},
                "detail": "no structured answer in completed call"}
    return {"disposition": "completed", "run_id": run_id, "answer": answer, "detail": ""}


def recipient_usable(req: dict, call: dict) -> bool:
    if call["disposition"] != "completed":
        return False
    answer = call["answer"]
    if not validate_answer_schema(answer, call):
        return False
    if answer.get("wrong_person"):
        call["disposition"] = "wrong_number"
        return False
    # Fail closed: consent must be explicitly true; missing/null/false all refuse.
    if answer.get("consent_given") is not True:
        call["disposition"] = "no_consent"
        return False
    if float(answer["confidence"]) < MIN_CONFIDENCE:
        call["disposition"] = "low_confidence"
        call["detail"] = f"recipient answer confidence {answer['confidence']} below {MIN_CONFIDENCE}"
        return False
    if answer.get("understood") is not True:
        call["disposition"], call["detail"] = "schema_drift", "recipient answer missing understood=true"
        return False
    choice = str(answer.get("choice") or "")
    counter = str(answer.get("counter_window") or "")
    if not choice and not counter:
        return False
    if choice and choice not in req.get("proposed_windows", []):
        call["disposition"], call["detail"] = "schema_drift", f"choice {choice} is not a proposed window"
        return False
    if counter:
        try:
            moment = datetime.fromisoformat(counter)
            if moment.tzinfo is None or moment < datetime.now(moment.tzinfo):
                raise ValueError
        except ValueError:
            call["disposition"], call["detail"] = "schema_drift", "counter_window is not a future ISO time"
            return False
    return True


def relay(req: dict, runner) -> dict:
    recipient_call = plan_and_run(runner, req, "recipient", goal_for_recipient(req), "rec")
    if recipient_call["disposition"] != "needs_recovery":
        recipient_ok = recipient_usable(req, recipient_call)
    else:
        recipient_ok = False
    result = {
        "request_id": req["request_id"],
        "relay": "needs_human",
        "agreed_window": None,
        "calls_placed": 1,
        "recipient_call": {"disposition": recipient_call["disposition"],
                           "run_id": recipient_call["run_id"],
                           "answer": scrub(recipient_call["answer"]),
                           "detail": recipient_call["detail"]},
        "requester_call": {"disposition": "skipped", "run_id": None, "answer": {}, "detail": ""},
        "needs_human_reason": None,
    }
    if recipient_call["disposition"] == "needs_recovery":
        result["needs_human_reason"] = ("run outcome uncertain; resolve manually with: "
                                        + str(recipient_call["detail"]))
        return result
    if not recipient_ok:
        result["needs_human_reason"] = (
            f"recipient call did not produce a usable answer: {recipient_call['disposition']} "
            f"{recipient_call['detail']}".strip())
        return result

    requester_call = plan_and_run(runner, req, "requester",
                                  goal_for_requester(req, recipient_call["answer"]), "req")
    result["calls_placed"] = 2
    result["requester_call"] = {"disposition": requester_call["disposition"],
                                "run_id": requester_call["run_id"],
                                "answer": scrub(requester_call["answer"]),
                                "detail": requester_call["detail"]}
    if requester_call["disposition"] != "completed":
        result["needs_human_reason"] = f"requester call ended: {requester_call['disposition']} {requester_call['detail']}".strip()
        return result
    accepted = requester_call["answer"]
    if not (isinstance(accepted.get("accepted"), bool) and isinstance(accepted.get("agreed_window"), str)
            and isinstance(accepted.get("notes", ""), str)):
        result["needs_human_reason"] = "requester answer failed schema validation; relay manually"
        return result
    agreed = str(accepted.get("agreed_window") or "")
    if accepted.get("accepted") is True and agreed in req.get("proposed_windows", []):
        result["relay"] = "agreed"
        result["agreed_window"] = agreed
        return result
    result["needs_human_reason"] = "requester did not accept a proposed window; relay their notes to a human"
    return result


def print_preview(req: dict) -> None:
    print(f"language-bridge-call preview — request {req['request_id']} (no calls placed)")
    print(f"  requester : {req['requester']['display_name']} ({req['requester']['role']}), "
          f"{mask_phone(req['requester']['phone'])}, {req['requester']['language']}")
    print(f"  recipient : {req['recipient']['first_name']}, "
          f"{mask_phone(req['recipient']['phone'])}, {req['recipient']['language']}")
    print(f"  topic     : {req['topic']}")
    if req.get("proposed_windows"):
        print("  windows   : " + ", ".join(req["proposed_windows"]))
    print("\n--- recipient call goal ---\n" + goal_for_recipient(req))
    print("\n--- requester call goal (filled from recipient answer at runtime) ---")
    print("  " + goal_for_requester(req, {"understood": True, "choice": "<window>", "notes": "<notes>"}).replace("\n", "\n  "))
    print("\n--- live commands this preview would lead to ---")
    print("  " + shlex.join(["calle", "call", "plan", "--to-phone", mask_phone(req["recipient"]["phone"]),
                            "--goal", "<reviewed recipient goal>", "--timezone", req["timezone"]]))
    print("  " + shlex.join(["calle", "call", "run", "--plan-id", "<plan_id>", "--confirm-token", "<token>"]))
    print("  " + shlex.join(["calle", "call", "status", "--run-id", "<run_id>", "--timezone", req["timezone"]]))
    print("\nThen the same three for the requester call, with the relayed answer.")
    print("Dry run only. Live execution: --execute --confirm-consent (requires calle auth).")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cross-language two-party relay via CALL-E.")
    parser.add_argument("--request", required=True, help="request JSON path")
    parser.add_argument("--fixture", help="canned CLI envelopes JSON; runs the relay with no network")
    parser.add_argument("--execute", action="store_true", help="place the relay calls (requires calle auth)")
    parser.add_argument("--confirm-consent", action="store_true", help="required with --execute")
    parser.add_argument("--poll-timeout-seconds", type=int, default=DEFAULT_POLL_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)

    try:
        req = load_request(args.request)
    except (RequestError, ValueError, OSError) as exc:
        print(f"request rejected: {exc}", file=sys.stderr)
        return 2

    if args.execute:
        if not args.confirm_consent:
            print("--execute requires --confirm-consent", file=sys.stderr)
            return 2
        prior = read_state(req["request_id"])
        if prior:
            print(
                f"refusing to re-run: request {req['request_id']} already has relay state "
                f"(status: {prior.get('status')}). One relay per request. If no call was placed, remove "
                f"{state_path(req['request_id'])}; otherwise resolve the prior run (recover command or manual "
                f"check) and use a new request_id.", file=sys.stderr)
            return 2
        runner = CliRunner()
        write_state(req["request_id"], {"status": "started"})
    elif args.fixture:
        runner = FixtureRunner(json.loads(Path(args.fixture).read_text(encoding="utf-8")))
    else:
        print_preview(req)
        return 0

    try:
        result = relay(req, runner)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"relay aborted: {exc}", file=sys.stderr)
        return 1
    if args.execute:
        write_state(req["request_id"], {"status": "done", "result": scrub(result)})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
