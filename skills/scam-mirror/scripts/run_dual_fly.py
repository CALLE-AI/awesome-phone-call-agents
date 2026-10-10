#!/usr/bin/env python3
"""Scam Mirror dual-fly verifier.

Dispatches two CALL-E "flies" and compares what they hear:

  Fly-A ("official") calls a published official line for the claimed
  organization and asks whether a "callback to verify your account" flow
  actually exists.

  Fly-B ("suspect") probes the suspect number and records red flags such as
  requests for one-time codes, transfers, remote control, or secrecy.

Default mode is DRY-RUN: no real call is placed, and bundled fixtures are used.
Pass --live to place real calls through the CALL-E Developer API. Real calls are
side effects; only use --live when you own the intent and have the callee's
context in mind.

Privacy: the attestation stores summaries and content hashes, not full
recordings or transcripts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
WHITELIST_PATH = SKILL_ROOT / "orgs.whitelist.json"
REGISTRY_PATH = SKILL_ROOT / "flies.registry.json"
RESULTS_DIR = SKILL_ROOT / "results"

CALLE_BASE_URL = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")

CALLE_BIN = SKILL_ROOT / "scripts" / "node_modules" / ".bin" / "calle"

TERMINAL_STATUSES = {
    "COMPLETED", "FAILED", "NO_ANSWER", "DECLINED",
    "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED",
}

DEFAULT_PERSONAS = {"official_verifier": "official-verifier-v1", "suspect_probe": "suspect-probe-v1"}

# Each red-flag rule: (flag_id, human label, keyword fragments).
RED_FLAG_RULES = [
    ("asks_for_otp", "asked for a one-time passcode or verification code",
     ["verification code", "one-time", "one time", "otp", "passcode"]),
    ("asks_for_password", "asked for a password or PIN",
     ["password", "pin number"]),
    ("asks_for_transfer", "asked for an immediate transfer or payment",
     ["transfer", "wire the", "send money"]),
    ("asks_for_remote_access", "asked for remote control or screen sharing",
     ["remote desktop", "remote control", "anydesk", "teamviewer", "screen share"]),
    ("asks_for_crypto", "asked for cryptocurrency",
     ["cryptocurrency", "bitcoin", "usdt", "crypto"]),
    ("demands_secrecy", "demanded secrecy from family or authorities",
     ["keep secret", "don't tell", "do not tell"]),
    ("threatens_arrest", "threatened arrest, detention, or asset freeze",
     ["arrest", "freeze your", "detain", "prosecutor"]),
    ("asks_to_install_app", "asked the user to install an app",
     ["install the app", "download the app"]),
]

OFFICIAL_FLY_SCHEMA = {
    "type": "object",
    "required": ["reached", "summary", "confirmed_business"],
    "properties": {
        "reached": {"type": "boolean"},
        "summary": {"type": "string"},
        "confirmed_business": {"type": "string", "enum": ["yes", "no", "unknown"]},
    },
}

SUSPECT_FLY_SCHEMA = {
    "type": "object",
    "required": ["reached", "summary", "red_flags"],
    "properties": {
        "reached": {"type": "boolean"},
        "summary": {"type": "string"},
        "red_flags": {"type": "array", "items": {"type": "string"}},
    },
}


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_number(number: str) -> str:
    digits = re.sub(r"[^0-9]", "", number or "")
    if digits.startswith("00"):
        digits = digits[2:]
    return digits


def numbers_equivalent(a: str, b: str) -> bool:
    a = normalize_number(a)
    b = normalize_number(b)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 8 and len(b) >= 8:
        return a.endswith(b[-8:]) or b.endswith(a[-8:])
    return False


def load_whitelist(path: Path = WHITELIST_PATH) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh).get("orgs", [])


def find_org(orgs: list[dict], claimed_org: str) -> dict | None:
    query = claimed_org.strip().lower()
    for org in orgs:
        names = [org.get("name", "").lower()] + [a.lower() for a in org.get("aliases", [])]
        if any(query in name or name in query for name in names):
            return org
    return None


def official_number_for(org: dict, region: str) -> str | None:
    regions = org.get("regions", {}) or {}
    return regions.get(region) or regions.get("US") or next(iter(regions.values()), None)


def detect_red_flags(text: str) -> list[str]:
    lowered = text.lower()
    found = []
    for flag_id, _label, keywords in RED_FLAG_RULES:
        if any(k in lowered for k in keywords):
            found.append(flag_id)
    return found


def red_flag_labels(flag_ids) -> list[str]:
    labels = {flag_id: label for flag_id, label, _ in RED_FLAG_RULES}
    return [labels.get(fid, fid) for fid in flag_ids]


def transcript_text(turns) -> str:
    return "\n".join(f"{t.get('speaker', '?')}: {t.get('text', '')}" for t in turns)


def build_task(kind: str, org_name: str, number: str, suspect_number: str) -> str:
    if kind == "official":
        return (
            f"Call {number} and ask whether {org_name} operates a 'callback to verify "
            f"your account or security status' flow for this number: {suspect_number}. "
            "Ask for a short yes/no confirmation and a one-sentence policy statement. "
            "Keep the call short. Do not provide personal details. If the representative "
            "asks for codes, passwords, or transfers, end the call."
        )
    return (
        f"Call {number}. You received a callback request claiming to be {org_name}. "
        "Ask neutrally what the call is about. Do not provide any real personal "
        "information. If the caller asks for a verification code, password, PIN, "
        "transfer, remote control, cryptocurrency, or secrecy from family, or threatens "
        "arrest, end the call immediately and record each such request as a red flag."
    )


def _http_json(method: str, url: str, payload: dict | None = None, timeout: int = 60) -> dict:
    headers = {
        "Authorization": f"Bearer {CALLE_API_KEY}",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def create_and_wait(task: str, phone: str, region: str, schema: dict) -> dict:
    payload = {
        "task": task,
        "recipients": [{"phones": [phone], "region": region, "locale": "en-US"}],
        "recipient_result_schema": schema,
        "metadata": {"workflow": "scam-mirror-dual-fly"},
    }
    created = _http_json("POST", f"{CALLE_BASE_URL}/v1/calls", payload)
    call_id = created.get("call_id") or created.get("id") or created.get("call")
    if not call_id:
        raise RuntimeError(f"Could not read call id from CALL-E response: {created}")

    for _ in range(90):
        status = _http_json("GET", f"{CALLE_BASE_URL}/v1/calls/{call_id}")
        if status.get("status") in {"completed", "failed", "cancelled", "canceled"}:
            return status
        time.sleep(6)
    raise TimeoutError(f"Call {call_id} did not reach a terminal state in time")


def parse_live_result(raw: dict, kind: str) -> dict:
    recipients = raw.get("recipients") or [{}]
    first = recipients[0] if recipients else {}
    structured = first.get("structured_result") or {}
    attempts = first.get("attempts") or [{}]
    turns = (attempts[0].get("transcript_turns") or []) if attempts else []
    text = transcript_text(turns)
    reached = raw.get("status") == "completed" and any(
        t.get("speaker") != "bot" for t in turns
    )
    summary = (
        structured.get("summary")
        or (raw.get("evidence") or [""])[0]
        or (text[:400] if text else "")
    )
    if kind == "official":
        return {
            "reached": reached,
            "summary": summary,
            "confirmed_business": structured.get("confirmed_business", "unknown"),
            "transcript": turns,
        }
    detected = list(dict.fromkeys(list(structured.get("red_flags", [])) + detect_red_flags(text)))
    return {
        "reached": reached,
        "summary": summary,
        "red_flags": detected,
        "transcript": turns,
    }


def calle_cli(args: list[str], timeout: int = 180) -> dict:
    if not CALLE_BIN.exists():
        raise RuntimeError(
            "CALL-E CLI not found. Run `npm install` in skills/scam-mirror/scripts."
        )
    proc = subprocess.run(
        [str(CALLE_BIN), *args], capture_output=True, text=True, timeout=timeout
    )
    if proc.returncode != 0:
        raise RuntimeError(f"calle {' '.join(args)} failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _structured(env: dict, key: str) -> dict:
    node = env.get(key)
    if not isinstance(node, dict):
        node = env.get("result")
    if not isinstance(node, dict):
        return {}
    sc = node.get("structuredContent")
    return sc if isinstance(sc, dict) else {}


def cli_call_start(goal: str, phone: str, region: str) -> tuple[str, dict]:
    args = ["call", "start", "--to-phone", phone, "--goal", goal]
    if region:
        args += ["--region", region]
    env = calle_cli(args, timeout=240)
    run_id = env.get("run_id")
    if not run_id:
        raise RuntimeError(f"calle call start returned no run_id: {env}")
    return run_id, _structured(env, "status_result")


def cli_call_plan(goal: str, phone: str, region: str) -> dict:
    args = ["call", "plan", "--to-phone", phone, "--goal", goal]
    if region:
        args += ["--region", region]
    env = calle_cli(args, timeout=240)
    return _structured(env, "result")


def safe_plan_summary(plan: dict) -> dict:
    return {
        "plan_id": plan.get("plan_id"),
        "ready_to_run": plan.get("ready_to_run"),
        "clarifying_questions": plan.get("clarifying_questions", []),
        "display_goal": plan.get("display_goal"),
    }


def cli_call_status(run_id: str) -> dict:
    return _structured(calle_cli(["call", "status", "--run-id", run_id]), "result")


def poll_cli(run_id: str, sc: dict) -> dict:
    for _ in range(54):  # ~9 minutes at 10-second intervals
        status = (sc.get("status") or "").upper()
        if status in TERMINAL_STATUSES:
            return sc
        time.sleep(10)
        sc = cli_call_status(run_id)
    return sc


def transcript_from_sc(sc: dict) -> list[dict]:
    raw = sc.get("transcript")
    if isinstance(raw, str):
        return [{"speaker": "user", "text": raw}]
    if isinstance(raw, list):
        return [t for t in raw if isinstance(t, dict)]
    return []


def derive_confirmed(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\b(?:no|never|not|don'?t|does not|do not|we do not)\b", lowered):
        return "no"
    if re.search(r"\b(?:yes|confirmed|correct|we do|we run|we offer)\b", lowered):
        return "yes"
    return "unknown"


def parse_cli_result(sc: dict, kind: str) -> dict:
    status = (sc.get("status") or "").upper()
    summary = sc.get("post_summary") or sc.get("summary") or sc.get("message") or ""
    turns = transcript_from_sc(sc)
    text = transcript_text(turns)
    reached = status == "COMPLETED" and any(t.get("speaker") != "bot" for t in turns)
    if kind == "official":
        return {
            "reached": reached,
            "summary": summary,
            "confirmed_business": derive_confirmed(f"{summary} {text}"),
            "transcript": turns,
        }
    return {
        "reached": reached,
        "summary": summary,
        "red_flags": detect_red_flags(f"{summary} {text}"),
        "transcript": turns,
    }


DRY_RUN_FIXTURES = {
    "official": {
        "reached": True,
        "summary": "The official line confirmed Example Bank does not operate an "
                   "'account frozen' callback flow and has no matching case for this number.",
        "confirmed_business": "no",
        "transcript": [
            {"speaker": "bot", "text": "Hi, I am verifying whether your bank asks customers to call back a number about account security."},
            {"speaker": "agent", "text": "We do not make such calls. Do not share any codes."},
        ],
    },
    "suspect": {
        "reached": True,
        "summary": "The caller claimed to be Example Bank fraud desk, asked for the "
                   "one-time passcode, and told the user to keep it secret from family.",
        "red_flags": ["asks_for_otp", "demands_secrecy"],
        "transcript": [
            {"speaker": "bot", "text": "Hi, I received a callback request about my account."},
            {"speaker": "suspect", "text": "Your account is frozen. Tell me the verification code we just sent, and do not tell your family."},
        ],
    },
}


def run_fly(kind: str, number: str, org_name: str, region: str, suspect_number: str, backend: str) -> dict:
    if backend == "dry":
        fixture = dict(DRY_RUN_FIXTURES[kind])
        fixture["number_called"] = number
        return fixture

    schema = OFFICIAL_FLY_SCHEMA if kind == "official" else SUSPECT_FLY_SCHEMA
    task = build_task(kind, org_name, number, suspect_number)

    if backend == "rest":
        parsed = parse_live_result(create_and_wait(task, number, region, schema), kind)
    elif backend == "cli":
        run_id, sc = cli_call_start(task, number, region)
        parsed = parse_cli_result(poll_cli(run_id, sc), kind)
    else:
        raise ValueError(f"unknown backend: {backend}")

    parsed["number_called"] = number
    return parsed


def build_verdict(official: dict, suspect: dict, suspect_number: str, official_number: str) -> dict:
    red_flags = suspect.get("red_flags", [])
    signals = red_flag_labels(red_flags)

    if numbers_equivalent(suspect_number, official_number):
        verdict = "likely_legit"
        confidence = 0.9
        signals.append("suspect number matches the published official number after normalization")
    elif red_flags:
        verdict = "likely_scam"
        confidence = min(0.95, 0.55 + 0.14 * len(red_flags))
        signals.append(f"detected {len(red_flags)} high-risk request(s)")
    elif official.get("confirmed_business") == "no" and suspect.get("reached"):
        verdict = "likely_scam"
        confidence = 0.78
        signals.append("official line does not confirm the claimed callback flow")
    elif not suspect.get("reached") and not official.get("reached"):
        verdict = "inconclusive"
        confidence = 0.25
        signals.append("neither fly reached a live answer")
    else:
        verdict = "inconclusive"
        confidence = 0.45
        signals.append("insufficient or conflicting evidence")

    return {"verdict": verdict, "confidence": round(confidence, 2), "signals": signals}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_registry(path: Path = REGISTRY_PATH) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def persona_for_role(registry: dict, role: str) -> dict:
    for persona in registry.get("personas", []):
        if persona.get("role") == role:
            return persona
    return {}


def fly_entry(registry: dict, fly_id: str, role: str) -> dict:
    persona = persona_for_role(registry, role)
    entry = {"id": fly_id, "generation": 1, "ttl_hours": 1}
    if not persona:
        entry["persona_id"] = DEFAULT_PERSONAS[role]
        return entry

    entry["persona_id"] = persona.get("persona_id", f"{role}-v1")
    persona_fields = {
        k: persona.get(k)
        for k in ("cell_type", "hemibrain_type", "body_id", "vfb_id", "superclass", "class")
    }
    persona_fields = {k: v for k, v in persona_fields.items() if v is not None}
    persona_fields["dataset"] = registry.get("dataset")
    persona_fields["license"] = registry.get("license")
    entry["persona"] = persona_fields
    return entry


def build_attestation(org_name, official_number, official, suspect, verdict, registry) -> dict:
    case_id = (
        "SM-"
        + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        + "-"
        + sha256_hex(suspect["number_called"])[:6]
    )
    official_text = transcript_text(official.get("transcript", []))
    suspect_text = transcript_text(suspect.get("transcript", []))
    official_hash = sha256_hex(official_text)
    suspect_hash = sha256_hex(suspect_text)

    verdict_core = {
        "case_id": case_id,
        "suspect_number": suspect["number_called"],
        "official_number": official_number,
        "verdict": verdict["verdict"],
        "official_hash": official_hash,
        "suspect_hash": suspect_hash,
    }
    verdict_hash = sha256_hex(json.dumps(verdict_core, sort_keys=True, ensure_ascii=False))

    note = {
        "likely_legit": "Suspect line matches a published official line.",
        "likely_scam": "Suspect line used high-risk requests; treat as a scam and do not comply.",
        "inconclusive": "Not enough evidence; verify the official number separately.",
    }[verdict["verdict"]]

    return {
        "case_id": case_id,
        "suspect_number": suspect["number_called"],
        "claimed_org": org_name,
        "verdict": verdict["verdict"],
        "confidence": verdict["confidence"],
        "signals": verdict["signals"],
        "official_fly": {
            "number_called": official["number_called"],
            "reached": official.get("reached", False),
            "summary": official.get("summary", ""),
            "content_hash": official_hash,
        },
        "suspect_fly": {
            "number_called": suspect["number_called"],
            "reached": suspect.get("reached", False),
            "summary": suspect.get("summary", ""),
            "red_flags": suspect.get("red_flags", []),
            "content_hash": suspect_hash,
        },
        "attestation": {
            "timestamp": now_iso(),
            "verdict_hash": verdict_hash,
            "note": note,
        },
        "flies": [
            fly_entry(registry, "A", "official_verifier"),
            fly_entry(registry, "B", "suspect_probe"),
        ],
    }


def parse_args(argv):
    p = argparse.ArgumentParser(description="Scam Mirror dual-fly verifier")
    p.add_argument("--number", required=True, help="Suspect number to probe (E.164).")
    p.add_argument("--org", required=True, help="Organization the caller claimed to be.")
    p.add_argument("--region", default="US", help="Region used to pick the official line.")
    p.add_argument("--official", help="Override the official number from the whitelist.")
    p.add_argument("--whitelist", default=str(WHITELIST_PATH), help="Path to orgs.whitelist.json.")
    p.add_argument("--out", default=None, help="Write the attestation to this path instead of the default results dir.")
    p.add_argument("--backend", choices=["dry", "cli", "rest"], default="dry",
                   help="dry-run (default) or live transport (cli / rest).")
    p.add_argument("--plan", action="store_true", help="Draft both fly plans through CALL-E without dialing.")
    p.add_argument("--live", action="store_true", help="Place real calls; implies --backend cli unless set.")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if args.live and args.backend == "dry":
        args.backend = "cli"

    if args.live:
        if args.backend == "rest" and not CALLE_API_KEY:
            print("--live --backend rest requires CALLE_API_KEY in the environment.", file=sys.stderr)
            return 2
        print("LIVE MODE: this will place real outbound phone calls.", file=sys.stderr)

    orgs = load_whitelist(Path(args.whitelist))
    org = find_org(orgs, args.org)
    org_name = org.get("name") if org else args.org
    official_number = args.official or (official_number_for(org, args.region) if org else None)
    if not official_number:
        print(
            f"No official number for '{args.org}' in the whitelist. "
            "Add it to orgs.whitelist.json or pass --official.",
            file=sys.stderr,
        )
        return 2

    if args.plan:
        official_goal = build_task("official", org_name, official_number, args.number)
        suspect_goal = build_task("suspect", org_name, args.number, args.number)
        plans = {
            "official_fly": {
                "number": official_number,
                **safe_plan_summary(cli_call_plan(official_goal, official_number, args.region)),
            },
            "suspect_fly": {
                "number": args.number,
                **safe_plan_summary(cli_call_plan(suspect_goal, args.number, args.region)),
            },
        }
        print(json.dumps(plans, indent=2, ensure_ascii=False))
        return 0

    official = run_fly("official", official_number, org_name, args.region, args.number, args.backend)
    suspect = run_fly("suspect", args.number, org_name, args.region, args.number, args.backend)

    registry = load_registry()
    verdict = build_verdict(official, suspect, args.number, official_number)
    attestation = build_attestation(org_name, official_number, official, suspect, verdict, registry)

    out = Path(args.out) if args.out else RESULTS_DIR / f"{attestation['case_id']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(attestation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps(attestation, indent=2, ensure_ascii=False))
    print(f"\nWrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
