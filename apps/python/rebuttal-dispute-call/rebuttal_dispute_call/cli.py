"""Preview, rehearse or place one dispute confirmation call through CALL-E.

    python -m rebuttal_dispute_call preview                          # script, schema, rules; no call
    python -m rebuttal_dispute_call dry-run --scenario ungrounded    # the default; a local fake answers
    python -m rebuttal_dispute_call live --to +1... --i-have-consent  # one real CALL-E call

A live call needs CALLE_API_KEY, an E.164 destination that is the number on record and is listed in
REBUTTAL_CALL_ALLOWLIST, --i-have-consent on that run, local calling hours at the destination, and
a CALL-E base URL of https://api.heycall-e.com or https://test-api.heycall-e.com. A submitted call
cannot be cancelled through the public CALL-E API, so every check runs before the create.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from . import call, rules
from .fake import SCENARIOS, FakeCalle

DEFAULT_TO = "+12125550101"  # reserved fictional number (NPA-555-01XX)
OUT = Path("out")
SUBCOMMANDS = ("preview", "dry-run", "live")
LABELS = {
    rules.NOT_E164: "E.164 destination",
    rules.NOT_ON_RECORD: "number on record",
    rules.NO_OPERATOR_INTENT: "operator intent on this run",
    rules.NOT_AUTHORIZED: "destination in allowlist",
    rules.OUTSIDE_HOURS: "local calling hours",
    rules.SCRIPT_NOT_FROM_TEMPLATE: "script from template",
    rules.SECOND_CALL: "one call per dispute",
}
_DISPUTE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_SMART = {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"}


def say(line: Any = "") -> None:
    """Every displayed line leaves phone-masked and as ASCII."""
    text = scrub(str(line))
    for fancy, plain in _SMART.items():
        text = text.replace(fancy, plain)
    print(text.encode("ascii", "replace").decode("ascii"))


def scrub(text: str | None) -> str:
    """Mask anything shaped like a phone number in words that came back from a call."""
    return call.scrub(text)


def decision(g: call.Grounding) -> str:
    """A no stops the filing even when it is not grounded; a yes is used only when grounded and usable."""
    if g.denied:
        return "stops the filing (CALL-E reported a no)"
    if g.usable and "yes" in (g.accepted.get("received"), g.accepted.get("recognises_charge")):
        return "would be filed as customer communication"
    return "would not be filed"


def called_disputes() -> set[str]:
    """Disputes that already have a live evidence document. That document is the only record kept."""
    return {p.stem for p in (OUT / "live").glob("*.pdf")}


def explain(code: str, phone: str, now: datetime) -> str:
    text = rules.MESSAGES[code]
    if code == rules.OUTSIDE_HOURS:
        text = call.local_hours_ok(phone or "", now)[1]
    elif code == rules.NOT_AUTHORIZED:
        text = f"{call.mask(phone)} is not listed in REBUTTAL_CALL_ALLOWLIST"
    return f"{code}: {text}"


def _parser(environ: Mapping[str, str]) -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--to", default=DEFAULT_TO, help="E.164 destination (default: a reserved fictional number)")
    common.add_argument("--on-record", help="the phone number stored on the order (default: the --to number)")
    common.add_argument("--merchant", default=environ.get("MERCHANT_NAME") or "Example Outfitters")
    common.add_argument("--order", default="1042", help="order id, spoken on the call")
    common.add_argument("--items", default="Trail shoes x1", help="what was ordered, spoken on the call")
    common.add_argument("--amount", default="$89.00", help="the disputed amount, spoken on the call")
    common.add_argument("--dispute", default="du_demo_1042", help="dispute id; also keys the idempotency key")
    ap = argparse.ArgumentParser(prog="python -m rebuttal_dispute_call", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("preview", parents=[common], help="print the script, schema, destination and rules; no call")
    dry = sub.add_parser("dry-run", parents=[common], help="a local fake CALL-E answers; nothing rings (default)")
    dry.add_argument("--scenario", choices=SCENARIOS, default="grounded", help="how the fake call goes")
    live = sub.add_parser("live", parents=[common], help="place one real CALL-E call")
    live.add_argument("--i-have-consent", action="store_true",
                      help="confirm, for this run, that the person at this number agreed to be called")
    live.add_argument("--timeout", type=float, default=600.0, help="seconds to follow the call locally")
    return ap


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def main(argv: list[str] | None = None, environ: Mapping[str, str] | None = None, *,
         now: datetime | None = None) -> int:
    if environ is None:
        _load_dotenv()
        environ = os.environ
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in (*SUBCOMMANDS, "-h", "--help"):
        argv = ["dry-run", *argv]
    args = _parser(environ).parse_args(argv)
    now = now or datetime.now(timezone.utc)
    if not _DISPUTE_ID.match(args.dispute):
        say("--dispute may contain only letters, digits, '_' and '-' (at most 64 characters)")
        return 2
    template = {"merchant": args.merchant, "order_id": args.order, "items": args.items, "amount": args.amount}
    task = call.build_task(**template)
    on_record = args.on_record or args.to

    say(f"dispute        {args.dispute} (order {args.order}, {args.merchant})")
    say(f"destination    {call.mask(args.to)}" + ("" if on_record == args.to else f" (on record: {call.mask(on_record)})"))
    say(f"script         {call.TEMPLATE_VERSION}")
    say(f"result fields  {', '.join(call.RESULT_SCHEMA['required'])}")
    say(f"idempotency    {call.idempotency_key(args.dispute)}")

    if args.command == "preview":
        return _preview(args, template, task, on_record, environ, now)
    if args.command == "dry-run":
        return _dry_run(args, template, task, on_record, now)
    return _live(args, template, task, on_record, environ, now)


def _preview(args, template, task, on_record, environ, now) -> int:
    say()
    say("task text (phone-masked preview; private original is sent verbatim)")
    for line in textwrap.wrap(task, 96):
        say(f"  {line}")
    blocked = rules.check_call(dispute_id=args.dispute, phone=args.to, on_record=on_record, task=task,
                               template_args=template, live=True, intent=False,
                               allowlist=environ.get("REBUTTAL_CALL_ALLOWLIST"), called=called_disputes(), now=now)
    say()
    say("rules for a live call right now (preview never has operator intent)")
    for code in rules.RULES:
        say(f"  BLOCK  {explain(code, args.to, now)}" if code in blocked else f"  PASS   {LABELS[code]}")
    say()
    say("no call placed")
    return 0


def _dry_run(args, template, task, on_record, now) -> int:
    blocked = rules.check_call(dispute_id=args.dispute, phone=args.to, on_record=on_record, task=task,
                               template_args=template, live=False, now=now)
    if rules.NOT_E164 in blocked:
        say(explain(rules.NOT_E164, args.to, now))
        return 2
    say("rules          " + ("pass" if not blocked else "a live call right now would be blocked: " + ", ".join(blocked)))
    say(f"mode           dry run: a local fake CALL-E answers (scenario {args.scenario}); nothing rings, no network")
    pdf = OUT / "dry-run" / f"{args.dispute}-{args.scenario}.pdf"
    return _run(FakeCalle(args.scenario), args, template, pdf, timeout=60.0)


def _live(args, template, task, on_record, environ, now) -> int:
    say("mode           LIVE: a real phone rings if every check passes. "
        "A submitted call cannot be cancelled through the public CALL-E API.")
    problems = []
    if not environ.get("CALLE_API_KEY"):
        problems.append("CALLE_API_KEY is not set")
    base_url = (environ.get("CALLE_BASE_URL") or rules.BASE_URLS[0]).strip().rstrip("/")
    if not rules.base_url_allowed(base_url):
        problems.append("CALLE_BASE_URL must be https://api.heycall-e.com or https://test-api.heycall-e.com")
    blocked = rules.check_call(dispute_id=args.dispute, phone=args.to, on_record=on_record, task=task,
                               template_args=template, live=True, intent=args.i_have_consent,
                               allowlist=environ.get("REBUTTAL_CALL_ALLOWLIST"), called=called_disputes(), now=now)
    problems += [explain(code, args.to, now) for code in blocked]
    if problems:
        say()
        say("Not calling:")
        for p in problems:
            say(f"  - {p}")
        return 2
    try:
        from calle import CalleClient
    except ImportError:
        say("Not calling: the calle-ai package is not installed (pip install -r requirements.txt)")
        return 2
    client = CalleClient(api_key=environ["CALLE_API_KEY"], base_url=base_url)
    try:
        return _run(client, args, template, OUT / "live" / f"{args.dispute}.pdf", timeout=args.timeout)
    except KeyboardInterrupt:
        say()
        say("Stopped following. The call keeps running at CALL-E and cannot be cancelled through the public API.")
        return 130
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def _run(client: Any, args, template, pdf: Path, *, timeout: float) -> int:
    try:
        created = call.place(client, dispute_id=args.dispute, phone=args.to, **template)
    except Exception as exc:  # the request may or may not have reached CALL-E
        say(f"create failed: {type(exc).__name__}")
        say("A call may still have been placed. Do not retry this dispute until you have checked the CALL-E dashboard;")
        say("a retry sends the same idempotency key, and nothing here retries on its own.")
        return 3
    call_id = created.get("id") or created.get("call_id", "")
    say(f"call           {call_id} ({created.get('status', 'created')})")
    say()
    try:
        rec = call.follow(
            client, call_id, timeout=timeout,
            on_event=lambda e: say(f"  event     {scrub(e.get('message') or e.get('type'))}"),
            on_turn=lambda t: say(f"  {call._clock(t.get('offset_seconds'))}     "
                                  f"{'caller  ' if call._is_caller(t) else 'customer'}  {scrub(t.get('text'))}"))
    except KeyboardInterrupt:
        raise
    except Exception as exc:
        say(f"following the call failed: {type(exc).__name__}. The call may still be running at CALL-E.")
        return 3
    g = call.ground(rec, args.merchant)
    say()
    say("checks")
    for c in g.checks:
        say(f"  {'PASS' if c.passed else 'FAIL'}  {c.name}: {scrub(c.detail)}" + (f' "{scrub(c.quote)}"' if c.quote else ""))
    say()
    say(f"CALL-E reported  received={g.reported.get('received', 'none')}  "
        f"recognises_charge={g.reported.get('recognises_charge', 'none')}")
    say(f"accepted         received={g.accepted['received']}  recognises_charge={g.accepted['recognises_charge']}")
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(call.evidence_pdf(rec, g, merchant=args.merchant, order_id=args.order,
                                      dispute_id=args.dispute, phone=args.to))
    say(f"document         {pdf.as_posix()}")
    say(f"decision         {decision(g)}")
    if rec.timed_out:
        say("note             the call had not finished when following stopped; it keeps running at CALL-E")
    return 0
