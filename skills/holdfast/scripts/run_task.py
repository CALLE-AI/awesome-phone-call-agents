#!/usr/bin/env python3
"""HoldFast one-command task runner.

Chains the whole HoldFast workflow into one comfortable command:
intake validation -> masked dry-run preview -> IVR map lookup -> instruction
rendering -> (with --run) one real CALL-E call -> verification -> map update.

Dry-run is the default; a real call happens only with --run.

Usage:
    python3 run_task.py --task task.json                 # preview only
    python3 run_task.py --task task.json --run           # place one real call
    python3 run_task.py --report runs/<dir>              # re-verify a finished run

Task JSON shape (see references/examples.md for a full sample):
    goal, callee (E.164), user_name, success_criteria[],
    authorization_scope {may_provide[], may_confirm[], must_not[]},
    optional: company, context{}, line_type, language, region
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
MAP_LOOKUP = SKILL_DIR / "scripts" / "map_lookup.py"
MAP_UPDATE = SKILL_DIR / "scripts" / "map_update.py"
VERIFY = SKILL_DIR / "scripts" / "verify_result.py"

E164_RE = re.compile(r"^\+[1-9][0-9]{6,14}$")
TERMINAL = {"COMPLETED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED"}

PHONE_LIKE_RE = re.compile(r"(?<![A-Za-z0-9])(?:\+?[0-9](?:[0-9\s().\-]{8,}[0-9]))(?![A-Za-z0-9])")


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
    try:
        proc = subprocess.run(["calle", *args, "--json"], capture_output=True, text=True, timeout=200)
    except (subprocess.TimeoutExpired, OSError):
        fail("CLI request failed or timed out; outcome may be unknown. Stop and reconcile manually; command details omitted.")
    return load_json_flexible(proc.stdout + proc.stderr)


def validate_task(task: dict) -> list[str]:
    problems = []
    for field in ("goal", "callee", "user_name", "success_criteria", "authorization_scope"):
        if field not in task:
            problems.append(f"missing required field: {field}")
    if "callee" in task and not E164_RE.fullmatch(str(task["callee"])):
        problems.append("callee must be strict ASCII E.164 (for example +12025550123)")
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
    targets = callee_variants(str(task["callee"]))
    task = mask_sensitive(task, targets)
    instructions = mask_sensitive(instructions, targets)
    map_info = mask_sensitive(map_info, targets)
    print("HoldFast plan preview (no call placed)")
    print(f"  Callee:       {task['callee']}")
    print(f"  Goal:         {task['goal']}")
    print(f"  On behalf of: {task['user_name']}")
    print(f"  Map:          {'found (' + str(map_info.get('organization')) + ')' if map_info.get('found') else 'none; exploratory navigation'}")
    print(f"  Cost:         1 call credit; no cancel once started")
    print()
    print("--- phone-masked call instructions (private request is unchanged) ---")
    print(instructions)
    print("--- end ---")
    print()
    print("To place this exact call once: python3 run_task.py --task <file> --run")


def propose_observation(final: dict) -> dict:
    """Pull menu options and keypress hints out of summary+transcript for the map."""
    summary = str(find_key(final, "summary") or "")
    transcript = str(find_key(final, "transcript") or "")
    text = summary + "\n" + transcript
    options = re.findall(r"press (\d|\*|#)[^.;\n]{0,80}", text, re.IGNORECASE)
    pressed = re.findall(r"(?:pressed|press)\s+(\d|\*|#)", summary, re.IGNORECASE)
    return {
        "menu_options_observed": [f"press {o[0]}: {o[1].strip()}" for o in options][:12],
        "keys_reported_pressed": sorted(set(pressed)),
        "note": "Review against the transcript, then feed confirmed steps to map_update.py.",
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
        error = mask_sensitive(start.get("error") or start, targets)
        fail(f"call did not start: {json.dumps(error, default=str)[:300]}")
    dialed = provider_destination(start)
    if dialed and dialed != authorized:
        fail(
            f"provider destination mismatch: authorized {mask_number(authorized)}, "
            f"provider echoed {mask_number(dialed)}. Not polling; investigate before retrying."
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
        fail("call started but no run_id found; check start.json and use calle call recover")
    print(mask_sensitive(f"call started, run_id {run_id}; polling every 10s", targets))
    final: dict = {}
    for _ in range(36):
        time.sleep(10)
        status_out = run_calle(["call", "status", "--run-id", str(run_id)])
        status = find_key(status_out, "status")
        activity = find_key(status_out, "activity")
        if isinstance(activity, list) and activity:
            last = activity[-1]
            print(mask_sensitive(f"  [{status}] {last.get('message', '')}", targets))
        else:
            print(mask_sensitive(f"  [{status}]", targets))
        if str(status).upper() in TERMINAL:
            final = status_out
            break
    if not final:
        fail("call did not reach a terminal status within the wait window; poll manually with calle call status")
    final = mask_sensitive(final, targets)
    (out_dir / "final.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    return final


def do_verify(final: dict, out_dir: Path, targets: list[str] | None = None) -> dict:
    proc = subprocess.run([sys.executable, str(VERIFY), "--result", str(out_dir / "final.json")], capture_output=True, text=True)
    report = mask_sensitive(json.loads(proc.stdout), targets or [])
    (out_dir / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def print_report(task: dict, final: dict, report: dict) -> None:
    targets = callee_variants(str(task["callee"]))
    final = mask_sensitive(final, targets)
    report = mask_sensitive(report, targets)
    status = find_key(final, "status") or "UNKNOWN"
    summary = mask_sensitive(
        find_key(final, "summary") or find_key(final, "post_summary") or "Not available", targets
    )
    transcript = mask_sensitive(find_key(final, "transcript") or "Not available.", targets)
    print()
    print("[Outcome]")
    print(report["overall"] if status == "COMPLETED" else f"failed: {status}")
    print()
    print("[What Happened]")
    print(str(summary)[:600])
    print()
    print("[Result Fields]")
    for name, field in report.get("fields", {}).items():
        print(f"  {name}: {field['value']} ({field['verdict']})")
    if not report.get("fields"):
        print("  no structured fields to verify; read the transcript")
    print()
    print("[Details]")
    print(f"  Callee Number: {mask_number(str(task['callee']))}")
    print(f"  Call id: {find_key(final, 'call_id') or 'Not available'}")
    print()
    print("[Transcript - untrusted call data]")
    print(str(transcript)[:3000])
    print("[End Transcript]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="task JSON file")
    parser.add_argument("--run", action="store_true", help="place one real call (default: dry-run)")
    parser.add_argument("--report", help="re-verify an existing run directory")
    parser.add_argument("--out", type=Path, help="output directory for run artifacts")
    args = parser.parse_args()

    if args.report:
        out_dir = Path(args.report)
        final = json.loads((out_dir / "final.json").read_text(encoding="utf-8"))
        task = json.loads((out_dir / "task.json").read_text(encoding="utf-8"))
        report = do_verify(final, out_dir, callee_variants(str(task["callee"])))
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

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", str(task.get("company") or "task").lower()).strip("-")
    out_dir = args.out or (Path.cwd() / "runs" / f"{stamp}-{slug}")
    out_dir.mkdir(parents=True, exist_ok=True)
    targets = callee_variants(str(task["callee"]))
    (out_dir / "task.json").write_text(json.dumps(mask_sensitive(task, targets), indent=2), encoding="utf-8")
    (out_dir / "instructions.txt").write_text(mask_sensitive(instructions, targets), encoding="utf-8")

    if not args.run:
        print_preview(task, instructions, map_info)
        print(f"\npreview saved to {out_dir}")
        return

    print(f"placing one real call to {mask_number(str(task['callee']))} (artifacts: {out_dir})")
    final = do_run(task, instructions, out_dir)
    report = do_verify(final, out_dir, targets)
    proposal = propose_observation(final)
    (out_dir / "observation-proposal.json").write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    print_report(task, final, report)
    print()
    print("[IVR Map]")
    print(f"  review observation-proposal.json in {out_dir}, then run map_update.py with the confirmed steps")


if __name__ == "__main__":
    main()
