"""CallFlow campaign runner — outbound campaigns with sentiment triage.

Reads a CSV of contacts, renders a goal template for each one, places calls
through CALL-E with a typed `result_schema`, and sorts the outcomes into
auto-closed / retry / needs-human.

Dry run is the default. Nothing is dialed unless --live is passed.

    python runner.py --campaign travel --contacts contacts.csv
    python runner.py --campaign travel --contacts contacts.csv --live \
        --allow +15555550100
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from calle import CalleClient
except ImportError:  # pragma: no cover - dependency guidance
    print("Missing dependency. Install with:  pip install calle-ai", file=sys.stderr)
    raise SystemExit(2) from None


# --------------------------------------------------------------- safety --

E164 = re.compile(r"^\+[1-9]\d{7,14}$")

# Statuses CALL-E reports when a call finishes.
TERMINAL = {"completed", "failed", "canceled"}
RETRYABLE = {"busy", "no_answer", "voicemail"}


def is_e164(phone: str) -> bool:
    return bool(E164.match(phone))


def mask(phone: str) -> str:
    """Mask a number for logs and summaries.

    Always hides at least half the characters, so a malformed number cannot
    leak most of a real one through an error message.
    """
    if len(phone) <= 6:
        return "***"
    reveal = min(3, len(phone) // 4)
    return f"{phone[:reveal]}{'*' * (len(phone) - 2 * reveal)}{phone[-reveal:]}"


def normalise(raw: str, default_cc: str = "1") -> str:
    """Best-effort E.164 normalisation. Ambiguous input stays unchanged so the
    caller rejects it rather than dialing a guess."""
    p = re.sub(r"[\s\-()./]", "", raw)
    if p.startswith("00"):
        p = "+" + p[2:]
    if not p.startswith("+"):
        if len(p) == 10:
            p = f"+{default_cc}{p}"
        elif 11 <= len(p) <= 15:
            p = f"+{p}"
    return p


@dataclass(frozen=True)
class Gate:
    allowed: bool
    reason: str = ""


def check_dial(phone: str, made: int, *, allowlist: list[str], ceiling: int) -> Gate:
    """Final check before dialing. Fails closed."""
    if not is_e164(phone):
        return Gate(False, f"not a valid E.164 number ({mask(phone)})")
    if made >= ceiling:
        return Gate(False, f"per-run ceiling of {ceiling} reached")
    if allowlist and phone not in allowlist:
        return Gate(False, f"{mask(phone)} is not in the allowlist")
    return Gate(True)


# ------------------------------------------------------------- schemas --

# Shared across every campaign, so triage works the same way regardless of
# what else a campaign extracts.
BASE_PROPERTIES: dict[str, Any] = {
    "outcome": {
        "type": "string",
        "enum": ["interested", "not_interested", "callback_requested", "no_decision"],
        "description": "The contact's overall decision on this call.",
    },
    "sentiment": {
        "type": "string",
        "enum": ["positive", "neutral", "negative"],
        "description": "Emotional tone of the contact during the conversation.",
    },
    "frustration_signals": {
        "type": "boolean",
        "description": "True if the contact was angry, rude, or asked to stop being called.",
    },
    "wants_human_callback": {
        "type": "boolean",
        "description": "True if the contact explicitly asked to speak to a human.",
    },
    "do_not_call": {
        "type": "boolean",
        "description": "True if the contact asked never to be contacted again.",
    },
    "summary": {
        "type": "string",
        "description": "Two-sentence factual summary of what was agreed or refused.",
    },
}


def build_schema(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {**BASE_PROPERTIES, **(extra or {})},
        "required": ["outcome", "sentiment", "frustration_signals", "summary"],
    }


# ----------------------------------------------------------- campaigns --


@dataclass
class Campaign:
    id: str
    name: str
    goal_template: str
    extra_fields: dict[str, Any] = field(default_factory=dict)
    region: str = "US"
    locale: str = "en"

    @property
    def schema(self) -> dict[str, Any]:
        return build_schema(self.extra_fields)


CAMPAIGNS: dict[str, Campaign] = {
    "travel": Campaign(
        id="travel",
        name="Travel enquiry follow-up",
        goal_template=(
            "You are a friendly travel consultant calling {name} back about "
            "their holiday enquiry.\n\n"
            "Open by greeting them by name and confirming this is a good time to "
            "talk. If it is not, apologise, ask when to call back, and end politely.\n\n"
            "Find out, conversationally and without interrogating them:\n"
            "  - which destination they have in mind\n"
            "  - roughly when they want to travel\n"
            "  - how many people are travelling\n"
            "  - whether they need flights, a hotel, a tour, or a full package\n\n"
            "Known context: {note}\n\n"
            "If they sound annoyed, do not push. Apologise once, offer to have a "
            "human colleague call them, and close warmly.\n\n"
            "Close by thanking them and saying a consultant will follow up. Do not "
            "promise pricing, a message, or a specific callback time."
        ),
        extra_fields={
            "destination": {"type": "string", "description": "Destination city or country."},
            "travel_date": {"type": "string", "description": "Preferred date, YYYY-MM-DD."},
            "party_size": {"type": "integer", "description": "Number of travellers."},
        },
    ),
    "appointment": Campaign(
        id="appointment",
        name="Appointment confirmation",
        goal_template=(
            "You are calling {name} to confirm their upcoming appointment.\n\n"
            "Greet them by name, state the appointment clearly, and ask whether "
            "they can still make it.\n\n"
            "Known context: {note}\n\n"
            "If they confirm, thank them and end. If they cannot make it, ask what "
            "day and time would suit better. If they want to cancel, accept it "
            "without pushing back.\n\n"
            "Keep the call under two minutes. Give no medical, legal, or financial "
            "advice — if asked, say a colleague will follow up."
        ),
        extra_fields={
            "confirmed": {"type": "boolean", "description": "True if the appointment was confirmed."},
            "reschedule_to": {"type": "string", "description": "Preferred new slot, if given."},
        },
    ),
}


# --------------------------------------------------------------- triage --


def triage(status: str, extracted: dict[str, Any]) -> tuple[str, str]:
    """Decide what happens to a resolved call.

    Order matters: hard opt-outs beat everything, then explicit human
    requests, then frustration, then reachability.
    """
    status = (status or "").lower()

    if extracted.get("do_not_call"):
        return "needs_human", "Contact requested do-not-call — suppress and log."
    if extracted.get("wants_human_callback"):
        return "needs_human", "Contact explicitly asked for a human."
    if extracted.get("frustration_signals"):
        return "needs_human", "Frustration detected during the call."

    # A negative tone without frustration usually means "bad time", not "bad
    # mood" — that deserves another attempt, not a human's attention.
    if str(extracted.get("sentiment", "")).lower() == "negative":
        return "retry", "Call went poorly but no frustration — worth one polite retry."

    if status in RETRYABLE:
        return "retry", f"Unreachable ({status}) — eligible for one retry."
    if status in {"failed", "canceled"}:
        return "unreachable", f"Call did not connect ({status})."
    if status == "completed":
        return "auto_closed", "Completed with no escalation signals."
    return "skipped", f"Unhandled status: {status or 'unknown'}"


# ------------------------------------------------------------ contacts --


def read_contacts(path: Path, default_cc: str) -> list[dict[str, str]]:
    """Read a CSV with name, phone, note columns (header optional)."""
    rows: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as fh:
        sample = fh.read(1024)
        fh.seek(0)
        has_header = "phone" in sample.lower().split("\n")[0]
        reader = csv.reader(fh)
        if has_header:
            header = [h.strip().lower() for h in next(reader)]
            idx = {k: header.index(k) for k in ("name", "phone", "note") if k in header}
        else:
            idx = {"name": 0, "phone": 1, "note": 2}

        for line_no, raw in enumerate(reader, start=2 if has_header else 1):
            if not any(c.strip() for c in raw):
                continue

            def cell(key: str) -> str:
                i = idx.get(key, -1)
                return raw[i].strip() if 0 <= i < len(raw) else ""

            rows.append(
                {
                    "line": str(line_no),
                    "name": cell("name"),
                    "phone": normalise(cell("phone"), default_cc),
                    "note": cell("note") or "no note on file",
                }
            )
    return rows


def render_goal(campaign: Campaign, contact: dict[str, str]) -> str:
    class Safe(dict):
        def __missing__(self, key: str) -> str:
            return ""

    return campaign.goal_template.format_map(Safe(**contact))


# --------------------------------------------------------------- runner --


def extract_result(call: dict[str, Any]) -> dict[str, Any]:
    """Pull CALL-E's structured extraction out of a call payload."""
    for key in ("structured_result", "result", "data"):
        value = call.get(key)
        if isinstance(value, dict) and value:
            return value
    recipients = call.get("recipients")
    if isinstance(recipients, list) and recipients:
        first = recipients[0]
        if isinstance(first, dict):
            for key in ("structured_result", "result"):
                value = first.get(key)
                if isinstance(value, dict) and value:
                    return value
    return {}


def run(args: argparse.Namespace) -> int:
    campaign = CAMPAIGNS[args.campaign]
    contacts = read_contacts(Path(args.contacts), args.country_code)
    if not contacts:
        print("No contacts found.", file=sys.stderr)
        return 1

    live = args.live
    allowlist = [a.strip() for a in (args.allow or "").split(",") if a.strip()]

    if live and not allowlist and not args.i_know_what_im_doing:
        print(
            "Refusing to run live without --allow. Pass a comma-separated list of\n"
            "E.164 numbers you own, or --i-know-what-im-doing to override.",
            file=sys.stderr,
        )
        return 2

    client = None
    if live:
        api_key = os.getenv("CALLE_API_KEY", "")
        if not api_key:
            print("CALLE_API_KEY is not set.", file=sys.stderr)
            return 2
        client = CalleClient(api_key=api_key)

    mode = "LIVE — real calls" if live else "DRY RUN — nothing is dialed"
    print(f"\n{campaign.name}  ·  {len(contacts)} contacts  ·  {mode}\n")

    results: list[dict[str, Any]] = []
    made = 0

    for contact in contacts:
        label = f"{contact['name'][:18]:<18} {mask(contact['phone']):<16}"
        goal = render_goal(campaign, contact)

        gate = check_dial(
            contact["phone"], made, allowlist=allowlist, ceiling=args.max_calls
        )
        if not gate.allowed:
            print(f"  BLOCKED   {label} {gate.reason}")
            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": "BLOCKED", "disposition": "skipped", "reason": gate.reason}
            )
            continue

        if not live:
            print(f"  DRY RUN   {label} goal rendered ({len(goal)} chars)")
            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": "DRY_RUN", "disposition": "skipped",
                 "reason": "Dry run — validated, no call placed", "goal": goal}
            )
            continue

        print(f"  DIALING   {label}", flush=True)
        try:
            assert client is not None
            created = client.calls.create(
                task=goal,
                recipient={
                    "phone": contact["phone"],
                    "region": campaign.region,
                    # NOTE: the field is `locale`, not `language` — CALL-E
                    # rejects `language` with 422 extra_forbidden.
                    "locale": campaign.locale,
                },
                result_schema=campaign.schema,
                metadata={"call-e/customerMetadata": {"campaign": campaign.id}},
                idempotency_key=f"{campaign.id}-{uuid.uuid4().hex[:12]}",
            )
            made += 1
            call_id = str(created["id"])

            deadline = time.monotonic() + args.timeout
            final = created
            while time.monotonic() < deadline:
                final = client.calls.get(call_id)
                if final.get("status") in TERMINAL:
                    break
                time.sleep(args.poll_interval)

            extracted = extract_result(final)
            status = str(final.get("status", "unknown"))
            disposition, reason = triage(status, extracted)
            print(f"            → {status} · {disposition} · {reason}")

            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": status, "disposition": disposition, "reason": reason,
                 "extracted": extracted, "call_id": call_id}
            )

        except Exception as exc:  # noqa: BLE001 - report and continue the batch
            print(f"            → FAILED {type(exc).__name__}: {exc}")
            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": "FAILED", "disposition": "unreachable",
                 "reason": f"{type(exc).__name__}: {exc}"}
            )

    counts: dict[str, int] = {}
    for r in results:
        counts[r["disposition"]] = counts.get(r["disposition"], 0) + 1

    print("\n  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in results:
            fh.write(json.dumps(r) + "\n")
    print(f"  results → {out}\n")

    needs_human = counts.get("needs_human", 0)
    if needs_human:
        print(f"  {needs_human} call(s) need a human. Review them first.\n")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Run an outbound calling campaign through CALL-E.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    # Not marked required, so --list-campaigns works on its own; both are
    # checked below once we know a run was actually requested.
    p.add_argument("--campaign", choices=sorted(CAMPAIGNS))
    p.add_argument("--contacts", help="CSV with name, phone, note")
    p.add_argument("--live", action="store_true", help="place real calls (default: dry run)")
    p.add_argument("--allow", default="", help="comma-separated E.164 numbers that may be dialed")
    p.add_argument("--i-know-what-im-doing", action="store_true",
                   help="permit --live with no allowlist")
    p.add_argument("--max-calls", type=int, default=5, help="per-run call ceiling")
    p.add_argument("--country-code", default="1", help="assumed code for 10-digit numbers")
    p.add_argument("--poll-interval", type=float, default=5.0)
    p.add_argument("--timeout", type=float, default=600.0)
    p.add_argument("--out", default="results/campaign_results.jsonl")
    p.add_argument("--list-campaigns", action="store_true")

    args = p.parse_args()

    if args.list_campaigns:
        for c in CAMPAIGNS.values():
            fields = ", ".join(c.extra_fields) or "—"
            print(f"  {c.id:<14} {c.name:<32} extracts: {fields}")
        return 0

    missing = [f"--{n}" for n in ("campaign", "contacts") if not getattr(args, n)]
    if missing:
        p.error(f"the following arguments are required: {', '.join(missing)}")

    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
