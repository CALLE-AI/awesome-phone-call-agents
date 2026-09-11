"""Thin wrapper over the CALL-E `calle` CLI.

Every call goes plan -> run -> poll(get_call_run). The one hard rule here,
learned the painful way: **capture and persist `run_id` and `recovery_id` the
instant `run_call` returns** — without them you cannot fetch the transcript, and
the raw response is gone. `place_call` writes them to `Memory.record_call`
before doing anything else.

The CLI already holds its own OAuth token from `calle auth login`, so no API key
is handled here.
"""

from __future__ import annotations

import json
import os
import subprocess
import time

from .util import authorized_dial, is_e164, mask_phone

_ENV = {
    "CALLE_SOURCE": os.environ.get("CALLE_SOURCE", "skills_sh"),
    "CALLE_INTEGRATION": os.environ.get("CALLE_INTEGRATION", "skills_sh_skill"),
    "CALLE_INTEGRATION_VERSION": os.environ.get("CALLE_INTEGRATION_VERSION", "0.1.0"),
}
# Statuses that mean "stop polling, the run is over".
_TERMINAL = {"COMPLETED", "COMPLETE", "FINISHED", "DONE", "SUCCESS", "FAILED",
             "NO_ANSWER", "VOICEMAIL", "ENDED", "CANCELLED", "ERROR", "TIMEOUT"}
# Of those, these are AMBIGUOUS system outcomes: never learn from them or advance
# the campaign — halt for reconciliation instead. (NO_ANSWER/VOICEMAIL/CANCELLED
# are clean outcomes the campaign may legitimately move past.)
_AMBIGUOUS = {"ERROR", "TIMEOUT", "UNKNOWN"}


class CalleError(RuntimeError):
    pass


def _deep_find(obj, key):
    """First value for `key` anywhere in a nested dict/list (CALL-E nests its
    real payload a few levels down and inconsistently)."""
    if isinstance(obj, dict):
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
        for v in obj.values():
            r = _deep_find(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _deep_find(v, key)
            if r is not None:
                return r
    return None


def _run_cli(args: list[str], timeout: int = 180) -> dict:
    env = {**os.environ, **_ENV, "PATH": f"{os.path.expanduser('~/.npm-global/bin')}:{os.environ.get('PATH','')}"}
    try:
        proc = subprocess.run(["calle", *args, "--json"], capture_output=True,
                              text=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        # A `call run` timeout may leave a call in flight server-side with no
        # run_id captured — surface it as an explicit reconciliation error.
        raise CalleError(
            f"calle {args[0]} timed out after {timeout}s; a call may be in flight — "
            f"reconcile via `calle` before retrying") from e
    out = proc.stdout.strip() or proc.stderr.strip()
    try:
        data = json.loads(out)
    except json.JSONDecodeError as e:
        raise CalleError(f"calle {args[0]} returned non-JSON: {out[:300]}") from e
    # Some payloads also embed a JSON string under result.content[].text — merge it.
    text_blob = _deep_find(data, "text")
    if isinstance(text_blob, str) and text_blob.startswith("{"):
        try:
            data.setdefault("_inner", json.loads(text_blob))
        except json.JSONDecodeError:
            pass
    return data


class Caller:
    def __init__(self, memory=None, region: str = None, language: str = None):
        self.memory = memory
        self.region = region or os.environ.get("CORTEX_REGION", "IN")
        self.language = language or os.environ.get("CORTEX_LANGUAGE", "English")

    def plan(self, phone: str, goal: str, *, language: str = None,
             region: str = None) -> dict:
        d = _run_cli(["call", "plan", "--to-phone", phone, "--goal", goal,
                      "--region", region or self.region,
                      "--language", language or self.language])
        return {
            "plan_id": _deep_find(d, "plan_id"),
            "confirm_token": _deep_find(d, "confirm_token"),
            "ready_to_run": bool(_deep_find(d, "ready_to_run")),
            "display_goal": _deep_find(d, "display_goal"),
        }

    def place_call(self, phone: str, goal: str, *, language: str = None,
                   region: str = None) -> dict:
        """Plan + run + persist ids. Returns {run_id, recovery_id, status}.

        Validates the destination before anything reaches CALL-E: it must be a
        strict E.164 number and pass the optional CORTEX_ALLOWED_DIAL allowlist.
        Both checks fail closed."""
        if not is_e164(phone):
            raise CalleError(f"refusing to dial non-E.164 destination: {mask_phone(phone)}")
        # Live dials require an explicit, non-empty allowlist match (fail closed).
        if not authorized_dial(phone, require_allowlist=True):
            raise CalleError(
                f"destination {mask_phone(phone)} is not in a configured CORTEX_ALLOWED_DIAL "
                f"allowlist (a non-empty allowlist is required for live calls)")
        p = self.plan(phone, goal, language=language, region=region)
        if not p["plan_id"] or not p["confirm_token"]:
            raise CalleError(f"plan not runnable: {p}")
        d = _run_cli(["call", "run", "--plan-id", p["plan_id"],
                      "--confirm-token", p["confirm_token"],
                      "--timezone", "Asia/Kolkata"])
        run_id = _deep_find(d, "run_id")
        recovery_id = _deep_find(d, "recovery_id")
        status = _deep_find(d, "status")
        if not run_id:
            raise CalleError(f"run_call gave no run_id (recovery_id={recovery_id})")
        # Persist BEFORE anything else can fail — this is the rule.
        if self.memory:
            self.memory.record_call(run_id, phone, recovery_id=recovery_id, outcome=status)
        return {"run_id": run_id, "recovery_id": recovery_id, "status": status}

    def status(self, run_id: str) -> dict:
        d = _run_cli(["call", "status", "--run-id", run_id])
        return {
            "status": _deep_find(d, "status"),
            "outcome": _deep_find(d, "outcome"),
            "summary": _deep_find(d, "summary") or _deep_find(d, "post_summary"),
            "transcript": _deep_find(d, "transcript"),
            "extracted": _deep_find(d, "extracted") or {},
        }

    def wait_for_result(self, run_id: str, *, phone: str = None, first_delay: int = 45,
                        interval: int = 12, max_polls: int = 20) -> dict:
        """Poll get_call_run until the run reaches a terminal state.

        `phone` is the caller *identity* to bind this result to (passed
        explicitly, not inferred). If polling exhausts without a terminal status
        and without a transcript, the result is flagged ``inconclusive`` so the
        caller can halt for reconciliation instead of treating it as a real
        outcome."""
        time.sleep(first_delay)
        last: dict = {}
        terminal = False
        for _ in range(max_polls):
            last = self.status(run_id)
            st = (last.get("status") or "").upper()
            if any(t in st for t in _TERMINAL) or last.get("transcript"):
                terminal = True
                break
            time.sleep(interval)
        final_st = (last.get("status") or "").upper()
        ambiguous = any(a in final_st for a in _AMBIGUOUS)
        # Inconclusive = an ambiguous error/timeout outcome, OR polling ran out
        # with no terminal status and no transcript. Either halts the campaign.
        last["inconclusive"] = ambiguous or (not terminal and not last.get("transcript"))
        if self.memory:
            self.memory.record_call(
                run_id, phone=phone,
                outcome=(last.get("status") or ("inconclusive" if last["inconclusive"] else None)),
                summary=last.get("summary"), transcript=last.get("transcript"))
        return last
