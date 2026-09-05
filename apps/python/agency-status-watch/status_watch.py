#!/usr/bin/env python3
"""Agency status watch: CALL-E navigates a public agency status line and returns the
state of your own application as structured JSON, re-checking on a decaying cadence
until the outcome is terminal, an action is required, or the check budget is spent.

Modes (default is preview; nothing dials unless --execute --confirm-consent):
  preview  validate the request, print masked parties, the call goal, cadence, live commands
  --fixture replay the full check state machine on canned CLI envelopes (no network)
  --execute run one due check through the CALL-E CLI (requires auth)
  --status  print the stored watch state without calling
  --cancel  cancel the watch; later --execute runs refuse

One watch per watch_id. Each check is one call to the agency's published line.
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
from datetime import datetime, timedelta, timezone
from pathlib import Path

E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
TERMINAL_STATUSES = {
    "BUSY", "CANCELED", "CANCELLED", "COMPLETED", "DECLINED",
    "EXPIRED", "FAILED", "NO_ANSWER", "VOICEMAIL",
}
MIN_CONFIDENCE = 0.7
POLL_INTERVAL_SECONDS = 15
DEFAULT_POLL_TIMEOUT_SECONDS = 300
# Transient call outcomes retry on the shortest step instead of failing the watch.
RETRY_AFTER_CALL_FAILURE_DAYS = 1
# Decaying re-check cadence after an in_process result: +1d, +2d, +4d, +8d.
DECAY_INTERVAL_DAYS = [1, 2, 4, 8]
DEFAULT_MAX_CHECKS = 5
SECRET_KEYS = {"confirm_token", "access_token", "refresh_token", "session_secret"}
# Structured-answer contract bound before the watch state machine acts on it.
STATUS_CATEGORIES = {
    "approved", "denied", "pending_action", "more_info_needed",
    "in_process", "not_found", "wrong_dept",
}
ANSWER_TYPES = {
    "status_category": str, "ivr_reached": bool, "spoke_with": str,
    "next_action": str, "next_action_deadline": str,
    "confidence": float, "notes": str,
}
REQUIRED_ANSWER_KEYS = ("status_category", "ivr_reached", "next_action", "confidence")
STATE_DIR_ENV = "AGENCY_STATUS_WATCH_STATE_DIR"


def state_dir() -> Path:
    return Path(os.environ.get(STATE_DIR_ENV, Path.home() / ".cache" / "agency-status-watch"))


def state_path(watch_id: str) -> Path:
    # sha256: filename-safe and collision-free for arbitrary watch_id strings.
    return state_dir() / (hashlib.sha256(watch_id.encode("utf-8")).hexdigest() + ".json")


def read_state(watch_id: str) -> dict | None:
    path = state_path(watch_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"status": "unreadable"}  # corrupted state: refuse rather than risk a duplicate call


def write_state(watch_id: str, payload: dict) -> None:
    path = state_path(watch_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"watch_id": watch_id, **payload}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def mask_phone(phone: str) -> str:
    return phone[:4] + "••••" + phone[-4:] if len(phone) >= 8 else "••••"


def mask_ref(ref: str) -> str:
    return ref[:2] + "••••" + ref[-4:] if len(ref) >= 6 else "••••••"


def scrub(obj):
    if isinstance(obj, dict):
        return {k: ("***" if k in SECRET_KEYS else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RequestError(ValueError):
    pass


def load_request(path: str) -> dict:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RequestError("request JSON must be an object")
    for key in ("watch_id", "topic", "timezone", "reference_number"):
        if not str(raw.get(key, "")).strip():
            raise RequestError(f"missing required field: {key}")
    if raw.get("consent") is not True:
        raise RequestError("consent must be true (the applicant must agree to this watch)")
    if raw.get("do_not_call"):
        raise RequestError("do_not_call is set; refusing")
    applicant = raw.get("applicant")
    if not isinstance(applicant, dict):
        raise RequestError("missing applicant block")
    for key in ("name", "language", "region"):
        if not str(applicant.get(key, "")).strip():
            raise RequestError(f"missing applicant.{key}")
    agency = raw.get("agency")
    if not isinstance(agency, dict):
        raise RequestError("missing agency block")
    for key in ("name", "phone", "language", "region"):
        if not str(agency.get(key, "")).strip():
            raise RequestError(f"missing agency.{key}")
    if not E164_RE.match(agency["phone"]):
        raise RequestError("agency.phone is not E.164: masked")
    max_checks = raw.get("max_checks", DEFAULT_MAX_CHECKS)
    if not isinstance(max_checks, int) or isinstance(max_checks, bool) or not 1 <= max_checks <= 10:
        raise RequestError("max_checks must be an integer between 1 and 10")
    raw["_max_checks"] = max_checks
    return raw


def goal_for_agency(req: dict, reference_number: str | None = None) -> str:
    ref = reference_number or req["reference_number"]
    return "\n".join([
        f"You are an AI phone assistant calling {req['agency']['name']}, a published public "
        "status line, on behalf of " + f"{req['applicant']['name']} about their own "
        f"{req['topic']} application.",
        "Disclose immediately to any human who answers that you are an AI assistant calling "
        "on the applicant's behalf about their own application.",
        f"Speak {req['agency']['language']} throughout.",
        "",
        "Navigate the automated menu (use keypad tones when prompted) to reach the section "
        f"that can see {req['topic']} application files. If a human answers, ask them directly.",
        f"Ask for the current status of the application with reference number {ref}. "
        "Read the status back to confirm you heard it correctly, then ask what, if anything, "
        "the applicant must do next and by when.",
        "Do not negotiate, request expedited processing, make statements about payments, or give "
        "legal, financial, or immigration advice. If the reference is not found or you reach the "
        "wrong department, record that politely and end the call.",
        "",
        "Before closing, record the outcome as JSON with exactly these fields:",
        'status_category: one of "approved", "denied", "pending_action", "more_info_needed", '
        '"in_process", "not_found", "wrong_dept"',
        "ivr_reached: boolean — true only if you reached a menu section or person that could see the file",
        "spoke_with: string — department or role, empty string if fully automated",
        'next_action: string — what the applicant must do next, or "none"',
        "next_action_deadline: string — ISO date YYYY-MM-DD, or empty string if none",
        "confidence: number between 0 and 1",
        "notes: one short sentence quoting what was said",
    ])


def _type_ok(value, expected) -> bool:
    if expected is bool:
        return isinstance(value, bool)  # bool is an int subclass; reject ints masquerading
    if expected is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, str)


def validate_answer_schema(answer: dict) -> str:
    """Return "" when the answer honors the contract, else a schema_drift reason."""
    for key in REQUIRED_ANSWER_KEYS:
        if not _type_ok(answer.get(key), ANSWER_TYPES[key]):
            return f"answer.{key} is missing or not {ANSWER_TYPES[key].__name__}"
    if answer["status_category"] not in STATUS_CATEGORIES:
        return f"answer.status_category {answer['status_category']!r} is not a known category"
    if not 0.0 <= float(answer["confidence"]) <= 1.0:
        return "answer.confidence outside [0, 1]"
    # A status claimed without reaching the file is drift, not a status.
    if answer["ivr_reached"] is False and answer["status_category"] not in {"not_found", "wrong_dept"}:
        return "ivr_reached is false but a file status was claimed"
    for key in ANSWER_TYPES:
        if key not in REQUIRED_ANSWER_KEYS and key in answer and not _type_ok(answer[key], ANSWER_TYPES[key]):
            return f"answer.{key} must be a string"
    deadline = str(answer.get("next_action_deadline") or "")
    if deadline:
        try:
            datetime.fromisoformat(deadline)
        except ValueError:
            return "answer.next_action_deadline is not an ISO date"
    return ""


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


def plan_and_run(runner, req: dict, goal: str) -> dict:
    """plan -> run -> status for one check call. Returns {disposition, run_id, answer, detail}."""
    base = ["calle", "call"]
    plan_cmd = base + ["plan", "--to-phone", req["agency"]["phone"],
                       "--goal", goal, "--timezone", req["timezone"],
                       "--language", req["agency"]["language"],
                       "--region", req["agency"]["region"]]
    plan = envelope_structured(runner.run("check_plan", plan_cmd))
    if not plan.get("plan_id") or not plan.get("ready_to_run") or not plan.get("confirm_token"):
        question = plan.get("clarification_question") or plan.get("clarifications") or ""
        return {"disposition": "schema_drift", "run_id": None, "answer": {},
                "detail": f"plan not ready: {str(question)[:300]}"}
    run = runner.run("check_run", base + [
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
    return poll_status(runner, base + ["status", "--run-id", run_id, "--timezone", req["timezone"]], run_id)


def poll_status(runner, cmd: list[str], run_id: str,
                poll_timeout_seconds: int = DEFAULT_POLL_TIMEOUT_SECONDS) -> dict:
    deadline = utcnow() + timedelta(seconds=poll_timeout_seconds)
    while True:
        envelope = runner.run("check_status", cmd)
        run_obj = (envelope.get("status_result") or {}).get("structuredContent") or envelope_structured(envelope)
        status = str(run_obj.get("status", "")).upper()
        if status in TERMINAL_STATUSES:
            return finish_call(status, run_obj, run_id)
        if isinstance(runner, FixtureRunner):
            return finish_call("SCHEMA_DRIFT", {}, run_id)
        if utcnow() >= deadline:
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


def classify(state: dict, call: dict) -> dict:
    """Map one finished check onto watch state. Fail-closed: unknown -> needs_human, no next check."""
    answer = call["answer"]
    drift = validate_answer_schema(answer)
    if call["disposition"] != "completed":
        # Transient outcomes (no answer, voicemail, busy) retry on the shortest step.
        if call["disposition"] in {"no_answer", "voicemail", "busy", "declined", "expired",
                                   "failed", "canceled", "cancelled"}:
            return {"watch": "watching", "next_check_due": utcnow() + timedelta(days=RETRY_AFTER_CALL_FAILURE_DAYS),
                    "needs_human_reason": None, "category": None}
        if call["disposition"] == "needs_recovery":
            return {"watch": "needs_human", "next_check_due": None,
                    "needs_human_reason": "run outcome uncertain; resolve manually with: " + str(call["detail"]),
                    "category": None}
        return {"watch": "needs_human", "next_check_due": None,
                "needs_human_reason": f"check did not produce a usable answer: {call['disposition']} {call['detail']}".strip(),
                "category": None}
    if drift:
        return {"watch": "needs_human", "next_check_due": None,
                "needs_human_reason": f"schema_drift {drift}", "category": None}
    if float(answer["confidence"]) < MIN_CONFIDENCE:
        return {"watch": "needs_human", "next_check_due": None,
                "needs_human_reason": f"agency answer confidence {answer['confidence']} below {MIN_CONFIDENCE}",
                "category": None}
    category = answer["status_category"]
    if category in {"approved", "denied"}:
        return {"watch": f"complete_{category}", "next_check_due": None, "needs_human_reason": None,
                "category": category}
    if category in {"pending_action", "more_info_needed"}:
        # The applicant must act; more calls add nothing. Stop the cadence.
        return {"watch": "action_required", "next_check_due": None, "needs_human_reason": None,
                "category": category}
    if category in {"not_found", "wrong_dept"}:
        return {"watch": "needs_human", "next_check_due": None,
                "needs_human_reason": f"agency reported {category}; verify the reference number and line",
                "category": category}
    # in_process: keep watching on the decaying cadence until the budget is spent.
    checks_done = state["checks_done"] + 1
    if checks_done >= state["max_checks"]:
        return {"watch": "max_checks_reached", "next_check_due": None,
                "needs_human_reason": "check budget spent while still in_process", "category": category}
    step = DECAY_INTERVAL_DAYS[min(checks_done - 1, len(DECAY_INTERVAL_DAYS) - 1)]
    return {"watch": "watching", "next_check_due": utcnow() + timedelta(days=step),
            "needs_human_reason": None, "category": category}


def check(req: dict, runner, checks_done: int = 0) -> dict:
    call = plan_and_run(runner, req, goal_for_agency(req))
    verdict = classify({"checks_done": checks_done, "max_checks": req["_max_checks"]}, call)
    return {
        "watch_id": req["watch_id"],
        "agency": req["agency"]["name"],
        "reference_masked": mask_ref(req["reference_number"]),
        "check_number": checks_done + 1,
        "watch": verdict["watch"],
        "next_check_due": verdict["next_check_due"].isoformat() if verdict["next_check_due"] else None,
        "call": {"disposition": call["disposition"], "run_id": call["run_id"],
                 "answer": scrub(call["answer"]), "detail": call["detail"]},
        "needs_human_reason": verdict["needs_human_reason"],
    }


def print_preview(req: dict) -> None:
    print(f"agency-status-watch preview — watch {req['watch_id']} (no calls placed)")
    print(f"  agency    : {req['agency']['name']}, {mask_phone(req['agency']['phone'])}, {req['agency']['language']}")
    print(f"  applicant : {req['applicant']['name']} ({req['topic']})")
    print(f"  reference : {mask_ref(req['reference_number'])}")
    print(f"  cadence   : up to {req['_max_checks']} checks; re-check at "
          + ", ".join(f"+{d}d" for d in DECAY_INTERVAL_DAYS)
          + "; stops on approved/denied/action-required/budget")
    print("\n--- call goal (reference masked; the live call sends the real one) ---\n"
          + goal_for_agency(req, mask_ref(req["reference_number"])))
    print("\n--- live commands this preview would lead to ---")
    print("  " + shlex.join(["calle", "call", "plan", "--to-phone", mask_phone(req["agency"]["phone"]),
                            "--goal", "<reviewed goal>", "--timezone", req["timezone"]]))
    print("  " + shlex.join(["calle", "call", "run", "--plan-id", "<plan_id>", "--confirm-token", "<token>"]))
    print("  " + shlex.join(["calle", "call", "status", "--run-id", "<run_id>", "--timezone", req["timezone"]]))
    print("\nDry run only. Live execution: --execute --confirm-consent (requires calle auth).")


def execute(req: dict) -> int:
    prior = read_state(req["watch_id"])
    if prior:
        status = prior.get("status")
        if status == "unreadable":
            print(f"refusing: state for {req['watch_id']} is unreadable; inspect "
                  f"{state_path(req['watch_id'])} manually", file=sys.stderr)
            return 2
        if status == "cancelled":
            print(f"refusing: watch {req['watch_id']} is cancelled; use a new watch_id to start over",
                  file=sys.stderr)
            return 2
        if status == "started":
            print(f"refusing: a previous check on {req['watch_id']} never finished; outcome unknown. "
                  "Resolve it manually (calle call recover, or check with the agency), then remove "
                  f"{state_path(req['watch_id'])} or use a new watch_id", file=sys.stderr)
            return 2
        if status not in {"watching"}:
            print(f"refusing: watch {req['watch_id']} is finished (status: {status}); "
                  "no further calls. Use a new watch_id for a new watch", file=sys.stderr)
            return 2
        due = prior.get("next_check_due")
        if due and datetime.fromisoformat(due) > utcnow():
            print(f"refusing: next check for {req['watch_id']} is due {due} (decaying cadence "
                  "protects the agency line and the call budget)", file=sys.stderr)
            return 2
    done_before = (prior or {}).get("checks_done", 0)
    write_state(req["watch_id"], {
        "status": "started",
        "checks_done": done_before,
        "max_checks": req["_max_checks"],
        "history": (prior or {}).get("history", []),
    })
    try:
        report = check(req, CliRunner(), done_before)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"check aborted: {exc}", file=sys.stderr)
        return 1
    history = (prior or {}).get("history", [])
    history.append({"at": utcnow().isoformat(), "watch": report["watch"],
                    "disposition": report["call"]["disposition"],
                    "run_id": report["call"]["run_id"]})
    write_state(req["watch_id"], {
        "status": report["watch"],
        "checks_done": done_before + 1,
        "max_checks": req["_max_checks"],
        "next_check_due": report["next_check_due"],
        "history": history,
    })
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def show_or_cancel(watch_id: str, cancel: bool) -> int:
    state = read_state(watch_id)
    if state is None:
        print(f"no state for watch {watch_id}", file=sys.stderr)
        return 2
    if cancel:
        if state.get("status") in {"cancelled"}:
            print(json.dumps(state, ensure_ascii=False, indent=2))
            return 0
        if state.get("status") not in {"watching", "started"}:
            print(f"watch {watch_id} is finished (status: {state.get('status')}); nothing to cancel",
                  file=sys.stderr)
            return 2
        state["status"] = "cancelled"
        state["next_check_due"] = None
        write_state(watch_id, state)
        print(f"watch {watch_id} cancelled; no further calls will be placed")
        return 0
    print(json.dumps(scrub(state), ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recurring agency status watch via CALL-E.")
    parser.add_argument("--request", help="request JSON path (required for preview/fixture/execute)")
    parser.add_argument("--fixture", help="canned CLI envelopes JSON; runs one check with no network")
    parser.add_argument("--execute", action="store_true", help="place one due check call (requires calle auth)")
    parser.add_argument("--confirm-consent", action="store_true", help="required with --execute")
    parser.add_argument("--status", action="store_true", help="print the stored watch state; no calls")
    parser.add_argument("--cancel", action="store_true", help="cancel the watch; no calls")
    parser.add_argument("--poll-timeout-seconds", type=int, default=DEFAULT_POLL_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)

    if args.status or args.cancel:
        if not args.request:
            print("--status/--cancel need --request (for watch_id)", file=sys.stderr)
            return 2
        req = load_request(args.request)
        return show_or_cancel(req["watch_id"], args.cancel)

    if not args.request:
        parser.print_usage(sys.stderr)
        return 2
    try:
        req = load_request(args.request)
    except (RequestError, ValueError, OSError) as exc:
        print(f"request rejected: {exc}", file=sys.stderr)
        return 2

    if args.execute:
        if not args.confirm_consent:
            print("--execute requires --confirm-consent", file=sys.stderr)
            return 2
        return execute(req)
    if args.fixture:
        runner = FixtureRunner(json.loads(Path(args.fixture).read_text(encoding="utf-8")))
        try:
            report = check(req, runner)
        except (RuntimeError, OSError, ValueError) as exc:
            print(f"check aborted: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    print_preview(req)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
