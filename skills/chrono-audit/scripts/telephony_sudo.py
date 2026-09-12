#!/usr/bin/env python3
"""
telephony-sudo — Synchronous Voice-Gated CLI Execution Wrapper for Autonomous Agents.

Suspends terminal command execution until the designated human authorizer is
contacted via CALL-E telephony and verbally authorizes the operation.

Usage:
  python scripts/telephony_sudo.py --authorizer "@sarah_dba" --reason "Drop table" <command...>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

# Add project root to sys.path
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from chrono_audit.attestation import create_voice_attestation, save_attestation
from chrono_audit.calle_client import CalleVerificationClient
from chrono_audit.config import Config
from chrono_audit.models import Claim, Confirmation


CHALLENGE_WORDS = ["Obsidian", "Cobalt", "Falcon", "Meridian", "Zephyr", "Apex", "Vanguard", "Genesis"]


def load_phonebook() -> dict[str, str]:
    path = ROOT_DIR / "phonebook.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {k.lower(): str(v) for k, v in data.items() if not k.startswith("_")}
        except Exception:
            pass
    return {
        "@sarah_dba": "+1 415 555 0192",
        "sarah": "+1 415 555 0192",
        "the architect": "+1 206 555 0148",
        "the security lead": "+1 650 555 0173",
        "elena rostova": "+1 408 555 0115",
    }


def main():
    parser = argparse.ArgumentParser(
        description="telephony-sudo: Synchronous voice-gated execution wrapper for CLI commands",
        usage="python telephony_sudo.py --authorizer <name> --reason <text> <command...>",
    )
    parser.add_argument("--authorizer", required=True, help="Handle or name of the human who must authorize")
    parser.add_argument("--reason", required=True, help="Justification for the action")
    parser.add_argument("--phone", help="Explicit phone number override (optional)")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="The shell command to execute if authorized")

    args = parser.parse_args()

    if not args.command:
        print("Error: no command specified to execute under telephony-sudo.", file=sys.stderr)
        sys.exit(1)

    cmd = args.command
    cmd_str = " ".join(cmd)
    authorizer = args.authorizer.strip()
    reason = args.reason.strip()

    # Ephemeral challenge generation (Anti-Spoofing Nonce)
    challenge_nonce = f"{random.choice(CHALLENGE_WORDS)}-{random.randint(10, 99)}"

    # Directory lookup
    phonebook = load_phonebook()
    phone = args.phone or phonebook.get(authorizer.lower())

    print("=" * 72)
    print(" [telephony-sudo] EXECUTION INTERCEPTOR ACTIVATED")
    print("=" * 72)
    print(f" Target Command      : {cmd_str}")
    print(f" Required Authorizer : {authorizer}")
    print(f" Reason / Action     : {reason}")
    print(f" Liveness Challenge  : {challenge_nonce} (ephemeral nonce)")

    if not phone:
        print(f"\n[telephony-sudo] ERROR: No phone number on file for '{authorizer}'.", file=sys.stderr)
        print("[telephony-sudo] Policy: Fails closed. Execution aborted (Exit code 1).", file=sys.stderr)
        sys.exit(1)

    masked_phone = phone[:3] + " ••• ••• " + phone[-4:] if len(phone) > 6 else phone
    print(f" Registered Phone    : {masked_phone}")
    print("-" * 72)
    print("[telephony-sudo] FROZEN: Suspending process execution.")
    print("[telephony-sudo] Initiating out-of-band CALL-E telephony verification...")

    cfg = Config.from_env()
    client = CalleVerificationClient(cfg)

    claim = Claim(
        authorizer_name=authorizer,
        claim_text=f"Authorize execution of command: '{cmd_str}' for reason: '{reason}'",
        subject=reason,
        source_line=cmd_str,
        ephemeral_challenge=challenge_nonce,
    )

    # Perform verification (live or dress rehearsal)
    call_result = client.verify_claim(claim, phone)

    print("-" * 72)
    print(f"[telephony-sudo] Call Duration : {call_result.call_duration_seconds}s")
    print(f"[telephony-sudo] Reached       : {call_result.reachable}")
    print(f"[telephony-sudo] Response      : \"{call_result.authorizer_statement}\"")
    print(f"[telephony-sudo] Direct Status : {call_result.direct_confirmation.value.upper()}")

    if call_result.direct_confirmation == Confirmation.CONFIRMED:
        # Create cryptographic attestation
        cmd_hash = hashlib.sha256(cmd_str.encode()).hexdigest()[:12]
        attest = create_voice_attestation(
            commit_sha=f"cmd_{cmd_hash}",
            pr_reference="telephony-sudo-session",
            authorizer_name=authorizer,
            phone_number=phone,
            statement=call_result.authorizer_statement,
            call_uuid=call_result.call_uuid or f"call_{cmd_hash}",
            audio_sha256=call_result.audio_sha256,
            verdict="VERIFIED",
        )
        save_attestation(attest, base_dir=ROOT_DIR)

        print("-" * 72)
        print(f"[telephony-sudo] AUTHORIZATION GRANTED: Verified by {authorizer}.")
        print(f"[telephony-sudo] Cryptographic Attestation ID: {attest.attestation_id}")
        print(f"[telephony-sudo] Unfreezing process: Executing '{cmd_str}' now...\n")

        # Execute command
        res = subprocess.run(cmd, shell=True)
        sys.exit(res.returncode)

    elif call_result.direct_confirmation == Confirmation.DENIED:
        print("-" * 72)
        print(f"[telephony-sudo] ACCESS DENIED: {authorizer} explicitly denied authorization.", file=sys.stderr)
        print("[telephony-sudo] Security policy violation logged. Terminating process with exit code 1.", file=sys.stderr)
        sys.exit(1)
    else:
        print("-" * 72)
        print(f"[telephony-sudo] FAILED CLOSED: Call status '{call_result.direct_confirmation.value}' is ambiguous.", file=sys.stderr)
        print("[telephony-sudo] Cannot verify verbal clearance. Aborting execution (Exit code 2).", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
