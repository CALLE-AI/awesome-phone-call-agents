#!/usr/bin/env python3
"""HoldFast one-command task runner.

Chains the whole HoldFast workflow into one comfortable command:
intake validation -> masked dry-run preview -> IVR map lookup -> instruction
rendering -> (with --run, after explicit confirmation) one real CALL-E call
-> verification -> map observation proposal.

Dry-run is the default; a real call happens only with --run, only after the
exact preview is shown, and only with an explicit confirmation (--yes flag or
an interactive "CALL" prompt).

Exactly-once dialing is enforced by a global ledger keyed on the task
fingerprint (never on the output directory): a task with a call in flight is
resumed, never re-dialed; a finished task re-dials only behind an explicit
--retry confirmation; a start the provider confirmed but the runner could not
account for is recorded "uncertain" and never re-dialed automatically.

Usage:
    python3 run_task.py --task task.json                 # preview only
    python3 run_task.py --task task.json --run           # preview, confirm, one call
    python3 run_task.py --task task.json --run --yes     # non-interactive confirm
    python3 run_task.py --task task.json --run --retry   # new consent-gated call after a finished one
    python3 run_task.py --task task.json --run --resume  # recover the in-flight call
    python3 run_task.py --report runs/<dir>              # re-verify a finished run

Task JSON shape (see references/examples.md for a full sample):
    goal, callee (E.164), user_name, success_criteria[],
    authorization_scope {may_provide[], may_confirm[], must_not[]},
    optional: company, context{}, line_type, language, region

Environment:
    HOLDFAST_LEDGER   path of the global dialing ledger
                      (default: ~/.cache/holdfast/ledger.json)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
MAP_LOOKUP = SKILL_DIR / "scripts" / "map_lookup.py"
MAP_UPDATE = SKILL_DIR / "scripts" / "map_update.py"
VERIFY = SKILL_DIR / "scripts" / "verify_result.py"

E164_RE = re.compile(r"\+[1-9][0-9]{6,14}")
TERMINAL = {"COMPLETED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED"}

PHONE_LIKE_RE = re.compile(r"(?<![A-Za-z0-9])(?:\+?[0-9](?:[0-9\s().\-]{8,}[0-9]))(?![A-Za-z0-9])")
MENU_OPTION_RE = re.compile(r"press\s+([0-9*#])\s*(?:for|to|:|-)?\s*([^.;\n]{0,80})", re.IGNORECASE)
FOR_PRESS_RE = re.compile(r"for\s+([^.;\n,]{2,60}?),?\s+press\s+([0-9*#])\b", re.IGNORECASE)
KEY_PRESSED_RE = re.compile(r"\bpressed\s+([0-9*#])\b", re.IGNORECASE)
NO_KEYPRESS_RE = re.compile(
    r"no\s+key\s+press\s+(?:was\s+)?recorded"
    r"|no\s+[^.;\n]{0,24}key\s*presses?\s+(?:was|were)\s+(?:recorded|captured)"
    r"|no\s+keys?\s+were\s+pressed"
    r"|did\s+not\s+press\s+any\s+(?:key|keys)",
    re.IGNORECASE,
)


def _mask_phone_match(match: re.Match) -> str:
    digits = re.sub(r"\D", "", match.group(0))
    if 10 <= len(digits) <= 15:
        return mask_number("+" + digits)
    return match.group(0)


def mask_number(number: str) -> str:
    return number[:2] + "*" * max(4, len(number) - 6) + number[-4:]


def mask_sensitive(value: object, extra_targets: list[str]) -> object:
    """Recursively mask phone numbers in provider output before it is stored
    or displayed. Targets include every spelling of the authorized callee
    plus any other phone-like sequence (E.164, NANP, with separators)."""
    if isinstance(value, str):
        masked = value
        for target in extra_targets:
            if len(target) >= 6:
                masked = masked.replace(target, mask_number(target))
        return PHONE_LIKE_RE.sub(_mask_phone_match, masked)
    if isinstance(value, list):
        return [mask_sensitive(item, extra_targets) for item in value]
    if isinstance(value, dict):
        return {key: mask_sensitive(item, extra_targets) for key, item in value.items()}
    return value


def callee_variants(callee: str) -> list[str]:
    digits = re.sub(r"\D", "", callee)
    spaced = " ".join(digits)
    variants = {callee, digits, spaced, " ".join(callee)}
    return [v for v in variants if len(v) >= 6]


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json_flexible(raw: str) -> dict:
    """Parse the first JSON object in a CLI output, tolerating trailing text."""
    decoder = json.JSONDecoder()
    start = raw.find("{")
    if start == -1:
        fail("no JSON object found in CLI output")
    try:
        obj, _ = decoder.raw_decode(raw[start:])
    except json.JSONDecodeError as exc:
        fail(f"could not parse CLI output: {exc}")
    if not isinstance(obj, dict):
        fail("CLI output JSON is not an object")
    return obj


def find_key(node: object, key: str) -> object | None:
    if isinstance(node, dict):
        if key in node and node[key] not in (None, ""):
            return node[key]
        for value in node.values():
            found = find_key(value, key)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = find_key(item, key)
            if found is not None:
                return found
    return None


def run_calle(args: list[str]) -> dict:
    """Invoke the calle CLI. Timeouts and a missing binary fail closed with a
    generic message: the command line (which contains the private goal text)
    is never echoed."""
    try:
        proc = subprocess.run(["calle", *args, "--json"], capture_output=True, text=True, timeout=200)
    except subprocess.TimeoutExpired:
        fail("calle did not respond within 200s; state unknown. Do not redial: run calle call recover, then --resume")
    except FileNotFoundError:
        fail("calle CLI not found on PATH; install and authenticate it before --run")
    return load_json_flexible(proc.stdout + proc.stderr)


def validate_task(task: dict) -> list[str]:
    problems = []
    for field in ("goal", "callee", "user_name", "success_criteria", "authorization_scope"):
        if field not in task:
            problems.append(f"missing required field: {field}")
    if "callee" in task and not isinstance(task["callee"], str):
        problems.append("callee must be a string")
    elif "callee" in task and not E164_RE.fullmatch(str(task["callee"])):
        problems.append("callee must be strict ASCII E.164 with no whitespace (for example +12025550123)")
    elif "callee" in task and not str(task["callee"]).isascii():
        problems.append("callee must contain ASCII digits only")
    scope = task.get("authorization_scope", {})
    for key in ("may_provide", "may_confirm", "must_not"):
        if key not in scope:
            problems.append(f"authorization_scope missing: {key}")
    if not isinstance(task.get("success_criteria"), list) or not task.get("success_criteria"):
        problems.append("success_criteria must be a non-empty list")
    return problems


def lookup_map(task: dict) -> dict:
    args = [sys.executable, str(MAP_LOOKUP)]
    if task.get("company"):
        args += ["--company", str(task["company"])]
    else:
        args += ["--number", str(task["callee"])]
    proc = subprocess.run(args, capture_output=True, text=True)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"found": False}


def render_instructions(task: dict, map_info: dict) -> str:
    scope = task["authorization_scope"]
    lines = [
        f"You are an AI voice assistant placing a phone call on behalf of {task['user_name']}, who delegated this errand.",
        "",
        f"TASK: {task['goal']}",
        "",
        "DISCLOSURE: When a human answers, your first sentence is: \"Hi, this is an AI assistant "
        f"calling on behalf of {task['user_name']}.\" If the person objects to speaking with an AI, "
        "apologize and end the call politely.",
    ]
    if task.get("line_type", "unknown") == "recorded":
        lines += [
            "",
            "LINE TYPE: The other end is a recorded line, not a person. Do not greet it, do not ask it "
            "questions, do not acknowledge it, and do not wait for answers. Listen to prompts, press keys "
            "per the navigation plan, and capture the spoken content.",
        ]
    known_path = "none; explore carefully"
    if map_info.get("found") and map_info.get("known_paths"):
        path = map_info["known_paths"][0].get("path", [])
        known_path = "; ".join(
            f"press {s.get('keypress')} for {s.get('meaning')}" for s in path if s.get("keypress")
        ) or "none; explore carefully"
    lines += [
        "",
        "IVR NAVIGATION: This line may have a phone menu. Listen to each menu fully before pressing any "
        "key. Press one key at a time, then listen again. Known path from previous calls: "
        f"{known_path}. If the same menu repeats twice, or no option matches the task, stop pressing "
        "keys and wait. Do not hang up early.",
        "",
        "HOLD: You may be placed on hold. Hold music and repeated announcements are not a person. "
        "Wait silently until a human or an interactive prompt addresses you directly.",
    ]
    if task.get("context"):
        rendered = "; ".join(f"{k}: {v}" for k, v in task["context"].items())
        lines += ["", f"CONTEXT: {rendered}."]
    lines += [
        "",
        "SCOPE: You may provide or confirm only: "
        + "; ".join(scope.get("may_provide", []) + scope.get("may_confirm", []))
        + ". Never agree to: "
        + "; ".join(scope.get("must_not", []))
        + ". If offered anything outside this scope, collect the reference number or terms, say the "
        "account holder will decide, and do not commit.",
        "",
        "REPORT BACK: At the end of the call, report: " + ", ".join(task["success_criteria"]) + ". "
        "Also report, in order: every menu prompt you heard, every key you pressed, how long you were "
        "on hold, and whether you reached a human, an automated system, or neither.",
    ]
    return "\n".join(lines)


def print_preview(task: dict, instructions: str, map_info: dict) -> None:
    """Show the plan. Everything displayed here is masked; the unmasked
    instructions exist only in memory and in the live CLI payload."""
    targets = callee_variants(str(task["callee"]))
    goal = mask_sensitive(str(task["goal"]), targets)
    shown_instructions = mask_sensitive(instructions, targets)
    print("HoldFast plan preview (no call placed)")
    print(f"  Callee:       {mask_number(str(task['callee']))}")
    print(f"  Goal:         {goal}")
    print(f"  On behalf of: {task['user_name']}")
    print(f"  Map:          {'found (' + str(map_info.get('organization')) + ')' if map_info.get('found') else 'none; exploratory navigation'}")
    print(f"  Cost:         1 call credit; no cancel once started")
    print()
    print("--- call instructions that will be sent ---")
    print(shown_instructions)
    print("--- end ---")


def preview_text(task: dict, instructions: str, map_info: dict) -> str:
    import io
    import contextlib
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        print_preview(task, instructions, map_info)
    return buffer.getvalue()


def confirm_or_abort(out_dir: Path, yes: bool) -> dict:
    """Gate the side effect behind one explicit confirmation.

    Returns a consent record written to consent.json. Anything other than an
    explicit yes aborts BEFORE any calle invocation: zero provider calls.
    """
    print("This places exactly one real call. It cannot be canceled once started.")
    if yes:
        consent = {"confirmed": True, "method": "--yes flag", "confirmed_at": _now()}
        print("Confirmation supplied via --yes.")
    elif sys.stdin.isatty():
        answer = input("Type CALL to place this exact call (anything else aborts): ").strip()
        consent = {"confirmed": answer == "CALL", "method": "interactive prompt", "confirmed_at": _now()}
    else:
        consent = {"confirmed": False, "method": "none", "confirmed_at": _now()}
        print("No confirmation available (stdin is not interactive).", file=sys.stderr)
        print("Re-run with --yes after reviewing this preview, or run without --run.", file=sys.stderr)
    (out_dir / "consent.json").write_text(json.dumps(consent, indent=2), encoding="utf-8")
    if not consent["confirmed"]:
        fail("call not confirmed; nothing was dialed")
    return consent


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _task_fingerprint(task: dict) -> str:
    canonical = json.dumps(task, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _callee_fingerprint(callee: str) -> str:
    return hashlib.sha256(re.sub(r"\D", "", callee).encode("ascii")).hexdigest()


# --------------------------------------------------------------------------
# Global exactly-once ledger
# --------------------------------------------------------------------------

def ledger_path() -> Path:
    override = os.environ.get("HOLDFAST_LEDGER")
    if override:
        return Path(override)
    return Path.home() / ".cache" / "holdfast" / "ledger.json"


def read_ledger() -> dict:
    path = ledger_path()
    if not path.exists():
        return {"version": 1, "tasks": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "tasks": {}, "corrupt": True}
    data.setdefault("tasks", {})
    return data


def write_ledger_entry(fingerprint: str, **fields: object) -> dict:
    """Atomically upsert one task entry in the global ledger."""
    path = ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    ledger = read_ledger()
    entry = dict(ledger["tasks"].get(fingerprint, {}))
    entry.update(fields)
    entry["updated_at"] = _now()
    ledger["tasks"][fingerprint] = entry
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix="ledger-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(ledger, handle, indent=2)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
    return entry


def ledger_entry(fingerprint: str) -> dict | None:
    return read_ledger().get("tasks", {}).get(fingerprint)


IN_FLIGHT_STATES = {"dialing", "in_flight", "uncertain"}


# --------------------------------------------------------------------------
# Per-run artifacts
# --------------------------------------------------------------------------

def read_local_ledger(out_dir: Path) -> dict | None:
    path = out_dir / "pending.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"state": "unknown", "corrupt": True}


def write_local_ledger(out_dir: Path, state: str, **fields: object) -> dict:
    path = out_dir / "pending.json"
    ledger: dict = {"state": state, "updated_at": _now()}
    if path.exists():
        try:
            ledger = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    ledger.update({"state": state, "updated_at": _now()})
    ledger.update(fields)
    path.write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    return ledger


def propose_observation(final: dict) -> dict:
    """Pull menu options and keypress claims out of the call for the map.

    Two strictly separated buckets:
    - menu_options_observed: what the line offered ("press 1 for X"),
      taken from the transcript only, verbatim-ish.
    - keys_reported_pressed: keys the call claims to have pressed, taken
      from explicit press claims only. "press 1 for X" menu phrasing never
      counts as a pressed key. An explicit "no key press was recorded"
      yields an empty list rather than a guessed one.
    """
    summary = str(find_key(final, "summary") or find_key(final, "post_summary") or "")
    transcript = str(find_key(final, "transcript") or "")
    ts_re = re.compile(r"^\[\d{2}:\d{2}:\d{2}\]\s*")
    bot_lines = [line for line in transcript.splitlines() if re.search(r"\bBOT:", line)]
    line_speakers = (ts_re.sub("", line) for line in transcript.splitlines())
    callee_lines = [
        line for line in line_speakers
        if line and not re.match(r"\s*BOT\s*:", line)
    ]

    # Menu options: what the line offered. Sources are the non-BOT turns
    # (the recording speaks the menu); BOT turns are excluded even when they
    # paraphrase a menu. Both phrasings are handled: "press 1 for X" and
    # "For X, press 1". One entry per key; a bare "press 1" is upgraded when
    # a later prompt gives it a meaning.
    by_key: dict[str, str] = {}

    def add_option(key: str, meaning: str) -> None:
        meaning = ts_re.sub("", meaning).strip(" .;:,-")
        if key in by_key:
            if meaning and not by_key[key]:
                by_key[key] = meaning
        else:
            by_key[key] = meaning

    for line in callee_lines:
        for match in MENU_OPTION_RE.finditer(line):
            add_option(match.group(1), match.group(2))
        for match in FOR_PRESS_RE.finditer(line):
            add_option(match.group(2), match.group(1))

    def key_sort(item: tuple[str, str]) -> tuple[int, int, str]:
        key = item[0]
        if key.isdigit():
            return (0, int(key), key)
        return (1, 0, key)

    options = [
        f"press {key}: {meaning}" if meaning else f"press {key}"
        for key, meaning in sorted(by_key.items(), key=key_sort)
    ][:12]

    # Keys pressed: only explicit press claims by the call itself, never
    # menu phrasing. An explicit "no key press was recorded" wins over any
    # weaker paraphrase and yields an empty list.
    no_keypress_observed = bool(NO_KEYPRESS_RE.search(summary)) or any(
        NO_KEYPRESS_RE.search(line) for line in bot_lines
    )
    pressed: list[str] = []
    if not no_keypress_observed:
        for source in (summary, *bot_lines):
            for match in KEY_PRESSED_RE.finditer(source):
                key = match.group(1)
                if key not in pressed:
                    pressed.append(key)

    return {
        "menu_options_observed": options,
        "keys_reported_pressed": sorted(pressed),
        "keypress_claim": "none" if no_keypress_observed else ("reported" if pressed else "unknown"),
        "note": "menu options come from transcript prompts; keys come only from explicit press claims. "
        "Review against the transcript, then feed confirmed steps to map_update.py.",
    }


def provider_destination(data: dict) -> str:
    """Echoed destination from provider output, when the provider returns one."""
    for key in ("to_phones", "to_phone", "callee", "destination"):
        value = find_key(data, key)
        if isinstance(value, list) and value and isinstance(value[0], str):
            return value[0]
        if isinstance(value, str):
            return value
    return ""


def do_run(task: dict, instructions: str, out_dir: Path) -> dict:
    authorized = str(task["callee"])
    targets = callee_variants(authorized)
    fingerprint = _task_fingerprint(task)
    write_local_ledger(out_dir, "dialing", task_fingerprint=fingerprint)
    write_ledger_entry(
        fingerprint,
        state="dialing",
        task_fingerprint=fingerprint,
        callee_digits_sha256=_callee_fingerprint(authorized),
        out_dir=str(out_dir),
    )
    args = ["call", "start", "--to-phone", authorized, "--goal", instructions]
    if task.get("language"):
        args += ["--language", str(task["language"])]
    if task.get("region"):
        args += ["--region", str(task["region"])]
    start = run_calle(args)
    (out_dir / "start.json").write_text(
        json.dumps(mask_sensitive(start, targets), indent=2), encoding="utf-8"
    )
    if not start.get("ok") or start.get("call_started") is not True:
        detail = "call start rejected by provider"
        write_local_ledger(out_dir, "never_started", detail=detail)
        write_ledger_entry(fingerprint, state="never_started", detail=detail)
        fail(f"call did not start: {mask_sensitive(json.dumps(start.get('error') or start, default=str)[:300], targets)}")
    dialed = provider_destination(start)
    if dialed and dialed != authorized:
        # The provider claims a call started, but not to the destination we
        # authorized. This call is unaccounted for: never redial, recover.
        run_id = find_key(start, "run_id")
        write_local_ledger(out_dir, "uncertain", detail="provider destination mismatch", run_id=run_id)
        write_ledger_entry(
            fingerprint,
            state="uncertain",
            run_id=run_id,
            detail="provider destination mismatch; do not redial; recover manually",
        )
        fail(
            f"provider destination mismatch: authorized {mask_number(authorized)}, "
            f"provider echoed {mask_number(dialed)}. The provider may have started an unaccounted "
            "call. Not polling, not redialing; run calle call recover and investigate."
        )
    (out_dir / "destination-check.json").write_text(
        json.dumps(
            {
                "authorized": mask_number(authorized),
                "provider_echo": mask_number(dialed) if dialed else "not echoed by provider",
                "match": (dialed == authorized) if dialed else "structurally pinned (runner builds the command from the authorized number only)",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    run_id = find_key(start, "run_id")
    if not run_id:
        write_local_ledger(out_dir, "uncertain", detail="call started but no run_id captured; recover manually via calle call recover")
        write_ledger_entry(
            fingerprint,
            state="uncertain",
            detail="call started but no run_id captured; do not redial; run calle call recover",
        )
        fail("call started but no run_id found; check start.json and use calle call recover")
    write_local_ledger(out_dir, "in_flight", run_id=run_id)
    write_ledger_entry(fingerprint, state="in_flight", run_id=run_id)
    print(f"call started, run_id {run_id}; polling every 10s")
    final = poll_until_terminal(str(run_id), targets)
    final = mask_sensitive(final, targets)
    (out_dir / "final.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    terminal_status = str(find_key(final, "status") or "UNKNOWN")
    write_local_ledger(out_dir, "finished", run_id=run_id, terminal_status=terminal_status)
    write_ledger_entry(fingerprint, state="finished", run_id=run_id, terminal_status=terminal_status)
    return final


def do_resume(task: dict, out_dir: Path) -> dict:
    """Recover an interrupted run from the global ledger. Never dials."""
    fingerprint = _task_fingerprint(task)
    entry = ledger_entry(fingerprint)
    if not entry:
        fail("no ledger entry for this exact task; nothing to resume (the ledger is keyed on the full task)")
    if entry.get("state") not in IN_FLIGHT_STATES:
        fail(f"ledger state for this task is {entry.get('state')}; nothing in flight to resume")
    expected_callee = _callee_fingerprint(str(task["callee"]))
    if entry.get("callee_digits_sha256") and entry["callee_digits_sha256"] != expected_callee:
        fail("task destination does not match the ledger entry; refusing to resume a different call")
    run_id = entry.get("run_id")
    if not run_id:
        fail(
            "ledger has no run_id (the call may have been lost before the id was recorded). "
            "Do not redial. Run: calle call recover   then re-run with --report on the saved artifact."
        )
    print(f"resuming in-flight call {run_id}; polling every 10s (no new call is placed)")
    final = poll_until_terminal(str(run_id), [])
    final = mask_sensitive(final, [])
    (out_dir / "final.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    terminal_status = str(find_key(final, "status") or "UNKNOWN")
    write_local_ledger(out_dir, "finished", run_id=run_id, terminal_status=terminal_status, resumed=True)
    write_ledger_entry(fingerprint, state="finished", run_id=run_id, terminal_status=terminal_status, resumed=True)
    return final


def poll_until_terminal(run_id: str, targets: list[str]) -> dict:
    for _ in range(36):
        time.sleep(10)
        status_out = run_calle(["call", "status", "--run-id", run_id])
        status = find_key(status_out, "status")
        activity = find_key(status_out, "activity")
        if isinstance(activity, list) and activity:
            last = activity[-1]
            message = mask_sensitive(str(last.get("message", "")), targets)
            print(f"  [{status}] {message}")
        else:
            print(f"  [{status}]")
        if str(status).upper() in TERMINAL:
            return status_out
    fail("call did not reach a terminal status within the wait window; poll manually with calle call status")


def do_verify(final: dict, out_dir: Path, targets: list[str]) -> dict:
    proc = subprocess.run([sys.executable, str(VERIFY), "--result", str(out_dir / "final.json")], capture_output=True, text=True)
    report = json.loads(proc.stdout)
    report = mask_sensitive(report, targets)
    (out_dir / "verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    return report


def print_report(task: dict, final: dict, report: dict) -> None:
    targets = callee_variants(str(task["callee"]))
    status = find_key(final, "status") or "UNKNOWN"
    summary = mask_sensitive(
        find_key(final, "summary") or find_key(final, "post_summary") or "Not available", targets
    )
    transcript = mask_sensitive(find_key(final, "transcript") or "Not available.", targets)
    print()
    print("[Outcome]")
    print(mask_sensitive(str(report["overall"]), targets) if status == "COMPLETED" else f"failed: {status}")
    print()
    print("[What Happened]")
    print(str(summary)[:600])
    print()
    print("[Result Fields]")
    for name, field in report.get("fields", {}).items():
        value = mask_sensitive(str(field["value"]), targets)
        verdict = mask_sensitive(str(field["verdict"]), targets)
        print(f"  {name}: {value} ({verdict})")
    if not report.get("fields"):
        print("  no structured fields to verify; read the transcript")
    print()
    print("[Details]")
    print(f"  Callee Number: {mask_number(str(task['callee']))}")
    print(f"  Call id: {mask_sensitive(str(find_key(final, 'call_id') or 'Not available'), targets)}")
    print()
    print("[Transcript - untrusted call data]")
    print(str(transcript)[:3000])
    print("[End Transcript]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="task JSON file")
    parser.add_argument("--run", action="store_true", help="place one real call after preview+confirmation")
    parser.add_argument("--yes", action="store_true", help="explicit non-interactive confirmation for --run")
    parser.add_argument("--retry", action="store_true", help="allow a new consent-gated call when the ledger shows this task already finished one")
    parser.add_argument("--resume", action="store_true", help="recover the in-flight call for this exact task; never dials")
    parser.add_argument("--report", help="re-verify an existing run directory")
    parser.add_argument("--out", type=Path, help="output directory for run artifacts")
    args = parser.parse_args()

    if args.report:
        out_dir = Path(args.report)
        final = json.loads((out_dir / "final.json").read_text(encoding="utf-8"))
        task = json.loads((out_dir / "task.json").read_text(encoding="utf-8"))
        report = do_verify(final, out_dir, [])
        print_report(task, final, report)
        return

    if not args.task:
        parser.error("provide --task or --report")
    task = json.loads(Path(args.task).read_text(encoding="utf-8"))
    problems = validate_task(task)
    if problems:
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        fail("task is incomplete; fill the fields above instead of guessing")

    map_info = lookup_map(task)
    instructions = render_instructions(task, map_info)
    targets = callee_variants(str(task["callee"]))
    fingerprint = _task_fingerprint(task)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", str(task.get("company") or "task").lower()).strip("-")
    out_dir = args.out or (Path.cwd() / "runs" / f"{stamp}-{slug}")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "task.json").write_text(
        json.dumps(mask_sensitive(task, targets), indent=2), encoding="utf-8"
    )
    (out_dir / "instructions.txt").write_text(
        str(mask_sensitive(instructions, targets)), encoding="utf-8"
    )
    (out_dir / "preview.txt").write_text(preview_text(task, instructions, map_info), encoding="utf-8")

    if not args.run:
        print_preview(task, instructions, map_info)
        print()
        print("To place this exact call once: python3 run_task.py --task <file> --run")
        print(f"preview saved to {out_dir}")
        return

    entry = ledger_entry(fingerprint)
    if args.resume:
        final = do_resume(task, out_dir)
        report = do_verify(final, out_dir, targets)
        proposal = propose_observation(final)
        (out_dir / "observation-proposal.json").write_text(
            json.dumps(mask_sensitive(proposal, targets), indent=2), encoding="utf-8"
        )
        print_report(task, final, report)
        return
    if entry and entry.get("state") in IN_FLIGHT_STATES:
        fail(
            f"the global ledger shows this exact task already has a call in flight "
            f"(state={entry.get('state')}, run_id={entry.get('run_id')}). Refusing to place a "
            "second call. Use: python3 run_task.py --task <file> --run --resume"
        )
    if entry and entry.get("state") == "finished" and not args.retry:
        fail(
            "the global ledger shows this exact task already placed one call "
            f"(run_id={entry.get('run_id')}, status={entry.get('terminal_status')}). "
            "Refusing to dial again without intent: use --resume to inspect, --report to "
            "re-verify, or add --retry to place a new consent-gated call."
        )

    print_preview(task, instructions, map_info)
    print()
    confirm_or_abort(out_dir, args.yes)
    print(f"placing one real call to {mask_number(str(task['callee']))} (artifacts: {out_dir})")
    final = do_run(task, instructions, out_dir)
    report = do_verify(final, out_dir, targets)
    proposal = propose_observation(final)
    (out_dir / "observation-proposal.json").write_text(
        json.dumps(mask_sensitive(proposal, targets), indent=2), encoding="utf-8"
    )
    print_report(task, final, report)
    print()
    print("[IVR Map]")
    print(f"  review observation-proposal.json in {out_dir}, then run map_update.py with the confirmed steps")


if __name__ == "__main__":
    main()
