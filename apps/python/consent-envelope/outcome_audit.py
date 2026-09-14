from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


def normalize(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.casefold()))


def bot_speech(transcript: str) -> str:
    """Return normalized BOT speech while excluding recipient speech."""
    parts = re.split(r"\b(BOT|USER)\s*:\s*", transcript, flags=re.IGNORECASE)
    turns: list[str] = []
    for index in range(1, len(parts) - 1, 2):
        if parts[index].casefold() == "bot":
            turns.append(parts[index + 1])
    return normalize(" ".join(turns))


@dataclass(frozen=True)
class OutcomeAudit:
    compliant: bool
    policy_sha256: str
    transcript_sha256: str
    missing_required_speech: tuple[str, ...]
    unexpected_bot_speech: str
    violations: tuple[str, ...]


def audit_outcome(
    *,
    transcript: str,
    required_speech: tuple[str, ...],
    hangup_by: str,
    attempt_count: int,
    voicemail_detected: bool,
) -> OutcomeAudit:
    if not isinstance(transcript, str) or not transcript.strip():
        raise ValueError("non-empty transcript evidence is required")
    if not required_speech or any(not isinstance(p, str) or not normalize(p) for p in required_speech):
        raise ValueError("non-empty approved speech is required")
    if type(attempt_count) is not int or attempt_count < 0:
        raise ValueError("attempt_count must be a non-negative integer")
    if type(voicemail_detected) is not bool:
        raise ValueError("voicemail_detected must be a JSON boolean")
    spoken = bot_speech(transcript)
    missing = tuple(phrase for phrase in required_speech if normalize(phrase) not in spoken)

    residue = spoken
    for phrase in sorted(required_speech, key=lambda item: len(normalize(item)), reverse=True):
        residue = residue.replace(normalize(phrase), " ", 1)
        residue = " ".join(residue.split())

    violations: list[str] = []
    if missing:
        violations.append("required speech missing")
    if residue:
        violations.append("bot speech exceeded the approved disclosure budget")
    if attempt_count != 1:
        violations.append("one-shot attempt policy violated")
    if voicemail_detected:
        violations.append("voicemail path was entered")
    if hangup_by.casefold() not in {"bot", "robot", "byrobot"}:
        violations.append("call was not ended by the bot")

    policy_material = json.dumps(
        {
            "required_speech": list(required_speech),
            "required_attempt_count": 1,
            "voicemail_allowed": False,
            "required_hangup_actor": "bot",
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return OutcomeAudit(
        compliant=not violations,
        policy_sha256=hashlib.sha256(policy_material.encode("utf-8")).hexdigest(),
        transcript_sha256=hashlib.sha256(transcript.encode("utf-8")).hexdigest(),
        missing_required_speech=missing,
        unexpected_bot_speech=residue,
        violations=tuple(violations),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a CALL-E transcript against an approved speech budget")
    parser.add_argument("record", type=Path, help="JSON containing transcript, required_speech, hangup_by, attempt_count, and voicemail_detected")
    args = parser.parse_args()
    raw = json.loads(args.record.read_text(encoding="utf-8"))
    result = audit_outcome(
        transcript=raw["transcript"],
        required_speech=tuple(raw["required_speech"]),
        hangup_by=raw["hangup_by"],
        attempt_count=raw["attempt_count"],
        voicemail_detected=raw["voicemail_detected"],
    )
    print(json.dumps(asdict(result), indent=2))
    return 0 if result.compliant else 3


if __name__ == "__main__":
    raise SystemExit(main())
