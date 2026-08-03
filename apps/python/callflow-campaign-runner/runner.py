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
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
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


def normalise(raw: str, default_cc: str = "") -> str:
    """Normalise only where the country is unambiguous.

    Strips formatting and converts an explicit `00` international prefix. A
    number with no country code is left alone so `check_dial` rejects it —
    guessing a country is how you dial a stranger. `--country-code` opts into
    the guess explicitly for a list you know is single-country.
    """
    p = re.sub(r"[\s\-()./]", "", raw)

    if p.startswith("00"):
        return "+" + p[2:]
    if p.startswith("+"):
        return p

    # Only prefix when the operator has stated the country for this batch.
    if default_cc and p.isdigit():
        return f"+{default_cc}{p}"

    # Ambiguous: return unchanged and let the gate reject it.
    return p


def _hash_phone(phone: str) -> str:
    """Hash used for suppression records, so the file holds no real numbers."""
    return hashlib.sha256(phone.encode()).hexdigest()


# Contacts read numbers, emails and card digits aloud, and CALL-E returns them
# inside free-text summaries. Those strings are written to disk, so they are
# redacted first.
_PHONE_IN_TEXT = re.compile(r"\+?\d[\d\s\-().]{7,}\d")
_EMAIL_IN_TEXT = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_LONG_DIGITS = re.compile(r"\b\d{6,}\b")


def redact(text: Any) -> Any:
    """Strip contact details from free text before it is stored.

    A summary is model-generated prose, so it can contain anything the contact
    said — "call me on 555 0100", an email, a card number. Masking the `phone`
    column but writing the summary verbatim would leak the same data one column
    over.
    """
    if not isinstance(text, str):
        return text
    out = _EMAIL_IN_TEXT.sub("[email redacted]", text)
    out = _PHONE_IN_TEXT.sub("[number redacted]", out)
    return _LONG_DIGITS.sub("[digits redacted]", out)


def redact_result(extracted: dict[str, Any]) -> dict[str, Any]:
    """Redact every free-text value in an extraction result."""
    return {k: redact(v) for k, v in extracted.items()}


def load_suppressions(path: str) -> set[str]:
    """Hashed numbers that must never be dialed again."""
    p = Path(path)
    if not p.exists():
        return set()
    out: set[str] = set()
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.add(line.split(",")[0].strip())
    return out


def record_suppression(path: str, phone: str, campaign_id: str) -> None:
    """Append an opt-out immediately.

    Written the moment CALL-E reports `do_not_call`, before any later step can
    fail — an opt-out that only lives in memory is not an opt-out. Stored as a
    hash so the file itself carries no personal data.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(
            "# Hashed numbers that opted out. Do not delete. One per line.\n",
            encoding="utf-8",
        )
    with p.open("a", encoding="utf-8") as fh:
        fh.write(f"{_hash_phone(phone)},{campaign_id}\n")


def record_dispatch(path: str, key: str, campaign_id: str, note: str) -> None:
    """Write a dispatch record *before* the API call is made.

    If the process dies between CALL-E accepting a call and us reading the
    result, that call still happened — the person's phone rang. Recording the
    intent first means the next run can see it, count it, and not re-dial.

    Only the idempotency key is stored, which is already a hash, so the ledger
    holds no phone numbers.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(
            "# Dispatch ledger: calls this runner has requested.\n"
            "# key,campaign,note\n",
            encoding="utf-8",
        )
    with p.open("a", encoding="utf-8") as fh:
        fh.write(f"{key},{campaign_id},{note}\n")
        fh.flush()
        os.fsync(fh.fileno())


def load_dispatches(path: str) -> set[str]:
    """Idempotency keys already dispatched in an earlier run."""
    p = Path(path)
    if not p.exists():
        return set()
    out: set[str] = set()
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.add(line.split(",")[0].strip())
    return out


def idempotency_key(
    campaign_id: str,
    phone: str,
    batch_id: str,
    *,
    task: str = "",
    schema: dict[str, Any] | None = None,
) -> str:
    """Stable key bound to the exact call being requested.

    Two identical requests produce the same key, so CALL-E returns the existing
    call rather than placing a second one. Change `--batch-id` to deliberately
    call the same people again.

    The rendered task and result schema are part of the key: editing a goal
    changes what the contact hears, so it must not silently reuse a call placed
    under the old wording. Keying on the ID alone would return a stale result
    for a conversation that never happened.

    The number is hashed, not embedded, so it never appears in logs or in an
    error echoed back by the API.
    """
    canonical_schema = json.dumps(schema or {}, sort_keys=True, separators=(",", ":"))
    payload = "|".join([campaign_id, phone, batch_id, task, canonical_schema])
    return f"{campaign_id}-{hashlib.sha256(payload.encode()).hexdigest()[:24]}"


@dataclass(frozen=True)
class Gate:
    allowed: bool
    reason: str = ""


def check_dial(
    phone: str,
    made: int,
    *,
    allowlist: list[str],
    ceiling: int,
    suppressed: set[str] | None = None,
) -> Gate:
    """Final check before dialing. Fails closed."""
    # Opt-outs are checked first: nothing else can override one.
    if suppressed and _hash_phone(phone) in suppressed:
        return Gate(False, f"{mask(phone)} previously opted out — suppressed")
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
    "callback_agreed": {
        "type": "boolean",
        "description": (
            "True only if the contact explicitly agreed to being called back. "
            "False if they did not say, or said no."
        ),
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


# Every field that must be present AND correctly typed before a completed
# call may auto-close. The consent booleans are here deliberately: an absent
# `do_not_call` is unknown, not permission.
REQUIRED_FIELDS: dict[str, type | tuple[type, ...]] = {
    "outcome": str,
    "sentiment": str,
    "summary": str,
    "frustration_signals": bool,
    "wants_human_callback": bool,
    "do_not_call": bool,
}

VALID_SENTIMENTS = {"positive", "neutral", "negative"}

# Below this, CALL-E's own judgement of the call is not worth acting on.
MIN_CONFIDENCE = 0.6


def validate_result(extracted: dict[str, Any]) -> list[str]:
    """Reasons this result cannot be trusted. Empty means it is safe to act on.

    Checks presence *and* type. A malformed value is worse than a missing one:
    `{"do_not_call": "no"}` is truthy in Python and would be read as an
    opt-out, while `{"do_not_call": "yes"}` read loosely could be missed.
    """
    problems: list[str] = []

    for name, expected in REQUIRED_FIELDS.items():
        if name not in extracted:
            problems.append(f"missing {name}")
        elif not isinstance(extracted[name], expected):
            problems.append(f"{name} is not {getattr(expected, '__name__', expected)}")

    sentiment = extracted.get("sentiment")
    if isinstance(sentiment, str) and sentiment.lower() not in VALID_SENTIMENTS:
        problems.append(f"sentiment '{sentiment}' is not a recognised value")

    return problems


def triage(
    status: str,
    extracted: dict[str, Any],
    *,
    task_completed: bool | None = None,
    confidence: float | None = None,
) -> tuple[str, str]:
    """Decide what happens to a resolved call.

    Fails closed: anything absent, malformed, unconfirmed, or low-confidence
    routes to a human. A call auto-closes only when every trust signal is
    present and positive.
    """
    status = (status or "").lower()

    if status == "completed":
        # A result we cannot verify is a result we cannot act on.
        problems = validate_result(extracted)
        if problems:
            return (
                "needs_human",
                f"Result not trustworthy ({'; '.join(problems)}) — review manually.",
            )

        # `None` means CALL-E did not say whether the goal was met. Absence is
        # not success, so it is treated exactly like an explicit failure.
        if task_completed is not True:
            reason = (
                "CALL-E reports the call goal was not completed."
                if task_completed is False
                else "CALL-E did not confirm the call goal was completed."
            )
            return "needs_human", reason

        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            return "needs_human", "No usable confidence score — review manually."
        if confidence < MIN_CONFIDENCE:
            return (
                "needs_human",
                f"Low confidence in the result ({confidence:.2f}) — review manually.",
            )

    if extracted.get("do_not_call"):
        return "needs_human", "Contact requested do-not-call — suppress and log."
    if extracted.get("wants_human_callback"):
        return "needs_human", "Contact explicitly asked for a human."
    if extracted.get("frustration_signals"):
        return "needs_human", "Frustration detected during the call."

    # A negative tone usually means "bad time", not "bad mood" — but calling
    # someone back is a decision only they can authorise. Without an explicit
    # callback agreement, a person decides whether to try again.
    if str(extracted.get("sentiment", "")).lower() == "negative":
        if extracted.get("callback_agreed") is True:
            return "retry", "Bad time, and the contact agreed to a callback."
        return (
            "needs_human",
            "Call went poorly and no callback was agreed — a person should decide.",
        )

    # Nobody answered, so there was no conversation and nothing to consent to.
    # Redialling an unanswered number is normal practice.
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

    # Opt-outs from previous runs. Checked in dry run too, so a preview shows
    # exactly which contacts a live run would skip.
    suppressed = load_suppressions(args.suppression_file)
    if suppressed:
        print(f"\n  {len(suppressed)} number(s) suppressed from earlier opt-outs")

    # Calls a previous run asked CALL-E to place. They may have connected even
    # if the result was never recorded, so they are not re-dialled.
    dispatched = load_dispatches(args.dispatch_file)
    if dispatched:
        print(f"  {len(dispatched)} call(s) already dispatched in earlier runs")

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
            contact["phone"],
            made,
            allowlist=allowlist,
            ceiling=args.max_calls,
            suppressed=suppressed,
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

        # Bound to the exact task and schema, so editing a goal does not
        # silently reuse a call placed under the old wording.
        key = idempotency_key(
            campaign.id,
            contact["phone"],
            args.batch_id,
            task=goal,
            schema=campaign.schema,
        )

        # A key in the ledger means an earlier run already asked CALL-E to
        # place this call. It may have connected even if we never saw the
        # result, so it counts against the ceiling and is not re-dialled.
        if key in dispatched:
            made += 1
            print(f"  SKIPPED   {label} already dispatched in an earlier run")
            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": "ALREADY_DISPATCHED", "disposition": "needs_human",
                 "reason": "Dispatched previously with no recorded result — reconcile manually.",
                 "idempotency_key": key}
            )
            continue

        print(f"  DIALING   {label}", flush=True)

        # Written before the request. If the process dies mid-call the phone
        # still rang, and the next run must know that.
        record_dispatch(args.dispatch_file, key, campaign.id, "requested")
        made += 1

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
                idempotency_key=key,
            )
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

            # CALL-E's own verdict on whether the goal was met, and how sure
            # it is. Auto-closing without checking these marks failed calls
            # as done.
            task_completed = final.get("task_completed")
            raw_conf = final.get("completion_confidence")
            confidence = (
                raw_conf.get("score") if isinstance(raw_conf, dict) else raw_conf
            )

            disposition, reason = triage(
                status,
                extracted,
                task_completed=task_completed,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )
            print(f"            → {status} · {disposition} · {reason}")

            # An opt-out must outlive this process, or the next run calls them
            # again. Recorded before anything else can fail.
            if extracted.get("do_not_call") is True:
                record_suppression(args.suppression_file, contact["phone"], campaign.id)
                print(f"            → added to {args.suppression_file}")

            # Summaries are model-generated prose and can quote a number or
            # email the contact read out. Redact before writing to disk.
            results.append(
                {"contact": contact["name"], "phone": mask(contact["phone"]),
                 "status": status, "disposition": disposition, "reason": reason,
                 "task_completed": task_completed, "confidence": confidence,
                 "extracted": redact_result(extracted), "call_id": call_id,
                 "idempotency_key": key}
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
    p.add_argument(
        "--country-code",
        default="",
        help="opt in to prefixing numbers that have no country code, e.g. --country-code 91. "
        "Off by default: without it, such numbers are rejected rather than guessed",
    )
    p.add_argument("--poll-interval", type=float, default=5.0)
    p.add_argument("--timeout", type=float, default=600.0)
    p.add_argument("--out", default="results/campaign_results.jsonl")
    p.add_argument(
        "--batch-id",
        default="default",
        help="groups calls for idempotency. Rerunning the same batch id will not "
        "re-dial; change it to deliberately call the same people again",
    )
    p.add_argument(
        "--suppression-file",
        default="results/do_not_call.txt",
        help="durable opt-out list. Numbers here are never dialed again",
    )
    p.add_argument(
        "--dispatch-file",
        default="results/dispatched.txt",
        help="ledger of calls already requested. Prevents re-dialing after a crash",
    )
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
