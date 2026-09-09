"""Command line entry point. Every command that could dial defaults to a no-call path."""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Optional

from . import engine, policy
from .client import OFFICIAL_ORIGIN, CalleClient, CalleError, FakeCalleServer
from .models import Ledger, mask_phone, new_case

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(HERE)
FIXTURES = os.path.join(APP_DIR, "fixtures")


def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def authorization_path(data_dir: str, case_id: str) -> str:
    return os.path.join(data_dir, "authorizations", f"{case_id}.json")


def load_authorization(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_authorization(path: str, auth: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(auth, f, indent=2, sort_keys=True)
    os.replace(tmp, path)


def live_client() -> CalleClient:
    """Live calls go to the official HTTPS origin only. A CALLE_BASE_URL override is refused, not silently ignored."""
    load_env(os.path.join(APP_DIR, ".env"))
    override = os.environ.get("CALLE_BASE_URL")
    if override and override.rstrip("/") != OFFICIAL_ORIGIN:
        raise CalleError(f"CALLE_BASE_URL={override!r} is not the official origin {OFFICIAL_ORIGIN}; unset it")
    return CalleClient(os.environ.get("CALLE_API_KEY", ""), OFFICIAL_ORIGIN)


def cmd_init_demo(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    with open(os.path.join(APP_DIR, "examples", "demo_cases.json"), "r", encoding="utf-8") as f:
        seeds = json.load(f)
    for s in seeds:
        case = new_case(**s)
        ledger.upsert(case)
        print(f"created {case['id']}  {case['company']}  {case['reference']}  hotline {mask_phone(case['hotline'])}")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    problems = policy.destination_problems(args.hotline, args.region)
    if problems:
        for code, text in problems:
            print(f"REFUSED {code}: {text}", file=sys.stderr)
        return 2
    ledger = Ledger(args.data)
    case = new_case(args.customer, args.company, args.hotline, args.region, args.type, args.reference, args.summary,
                    args.owed, args.opened, locale=args.locale, timezone_name=args.timezone, ivr_hints=args.ivr or None)
    ledger.upsert(case)
    print(case["id"])
    return 0


def cmd_authorize(args: argparse.Namespace) -> int:
    """Write the live authorization record: exact destination, expiry, call budget, unattended yes/no."""
    ledger = Ledger(args.data)
    case = ledger.get(args.case)
    if args.hotline != case["hotline"]:
        print(f"REFUSED: --hotline must repeat the case hotline exactly ({mask_phone(case['hotline'])}); this is the authorization.", file=sys.stderr)
        return 2
    try:
        auth = engine.new_authorization(case, args.until, args.max_calls, args.unattended)
    except ValueError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    path = authorization_path(args.data, case["id"])
    save_authorization(path, auth)
    print(f"authorized {mask_phone(auth['destination'])} ({auth['region']}) for {case['id']} until {auth['expires_on']}, "
          f"max {auth['max_calls']} calls, unattended={auth['unattended']}\n{path}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    for c in ledger.list_cases():
        reasons = policy.suppression_reasons(c)
        gate = "CALLABLE" if not reasons else "held: " + reasons[0][0]
        pend = f"  question: {c.get('pending_question')}" if c.get("pending_question") else ""
        print(f"{c['id']}  {c['status']:<20} esc={c['escalation_level']}  calls={len(c['calls'])}  {c['company']} {c['reference']}  [{gate}]{pend}")
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    res = engine.run_cycle(ledger, args.case, "preview", force=args.force)
    if "request" not in res:
        print(f"NO CALL: {res['reason']}")
        return 2
    req = res["request"]
    print(f"PREVIEW ONLY. Would dial {res['masked_hotline']} (region {req['recipients'][0]['region']}). Nothing was sent.")
    print("-" * 72)
    print(req["task"])
    print("-" * 72)
    print("result_schema keys:", ", ".join(req["result_schema"]["required"]))
    return 0


def _print_result(res: Dict[str, Any], mode: str) -> int:
    if not res["placed"]:
        print(f"NO CALL: {res['reason']}")
        return 2
    call = res["call"]
    r = call.get("structured_result") or {}
    print(f"call {call['id']} [{mode}] -> {call['disposition']}  outcome={r.get('outcome')}  case now {res['case']['status']}")
    if r.get("commitment_action"):
        print(f"  commitment: {r['commitment_action']} by {r.get('commitment_by_date') or '?'}  \"{r.get('commitment_quote')}\"")
    if res["case"].get("pending_question"):
        print(f"  HUMAN NEEDED: {res['case']['pending_question']}")
    if res["case"].get("next_call_after"):
        print(f"  next chase after {res['case']['next_call_after'][:16]}")
    if call.get("result_problems"):
        print(f"  result rejected: {', '.join(call['result_problems'])}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    if args.mode == "preview":
        return cmd_plan(args)
    fake = None
    auth = None
    auth_path = None
    unattended = False
    if args.mode == "fixture":
        fake = FakeCalleServer(FIXTURES, default_scenario=args.scenario or "first_call_commitment").start()
        client = CalleClient("fixture-key", fake.base_url, allow_local_fake=True)
    else:
        if args.force:
            print("REFUSED: --force is not available in live mode; every policy hold applies to a real call.", file=sys.stderr)
            return 3
        if bool(args.yes) == bool(args.authorization):
            print("LIVE mode places a real phone call and uses CALL-E credits. Interactive: re-run with --yes. "
                  "Scheduled: pass --authorization <record> instead (never both).", file=sys.stderr)
            return 3
        unattended = bool(args.authorization)
        auth_path = args.authorization or authorization_path(args.data, args.case)
        auth = load_authorization(auth_path)
        try:
            client = live_client()
        except CalleError as e:
            print(f"REFUSED: {e}", file=sys.stderr)
            return 3
    try:
        res = engine.run_cycle(ledger, args.case, args.mode, client=client, fixture_scenario=args.scenario, force=args.force,
                               webhook_url=os.environ.get("CASECHASER_WEBHOOK_URL", ""), authorization=auth, unattended=unattended)
    except CalleError as e:
        print(f"ERROR: {e}\nIf a call may have been created, run `reconcile {args.case}` before anything else.", file=sys.stderr)
        return 4
    finally:
        if fake:
            fake.stop()
    if auth is not None and auth_path and res["placed"]:
        save_authorization(auth_path, auth)
    return _print_result(res, args.mode)


def cmd_reconcile(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    case = ledger.get(args.case)
    pc = case.get("pending_call")
    if not pc:
        print("nothing pending")
        return 0
    client = None
    if not args.clear:
        try:
            client = live_client() if pc.get("mode") == "live" else None
        except CalleError as e:
            print(f"REFUSED: {e}", file=sys.stderr)
            return 3
        if client is None:
            print("pending call is not a live call; pass --clear to drop it", file=sys.stderr)
            return 2
    res = engine.reconcile(ledger, args.case, client=client, call_id=args.call_id, clear=args.clear)
    if res["reason"] == "cleared":
        print("cleared; no call recorded")
        return 0
    if not res["placed"]:
        print(f"NOT RECONCILED: {res['reason']}", file=sys.stderr)
        return 2
    return _print_result(res, pc.get("mode", "live"))


def cmd_decide(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    case = engine.record_decision(ledger, args.case, args.decision, resume=not args.close)
    if args.close:
        case["status"] = "abandoned" if args.close == "abandon" else "resolved"
        ledger.upsert(case)
    print(f"{case['id']} -> {case['status']}")
    return 0


def cmd_evidence(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data)
    text = engine.evidence_pack(ledger.get(args.case))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from .dashboard import serve
    return serve(args.data, args.host, args.port, FIXTURES)


def cmd_fake_server(args: argparse.Namespace) -> int:
    fake = FakeCalleServer(FIXTURES, default_scenario=args.scenario, host=args.host, port=args.port).start()
    print(f"fake CALL-E API at {fake.base_url}  (scenario {args.scenario}); Ctrl-C to stop")
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        fake.stop()
    return 0


def main(argv: Any = None) -> int:
    p = argparse.ArgumentParser(prog="casechaser", description=__doc__)
    p.add_argument("--data", default=os.environ.get("CASECHASER_DATA", os.path.join(os.getcwd(), "data")), help="ledger directory")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-demo", help="seed two fictional demo cases").set_defaults(fn=cmd_init_demo)
    a = sub.add_parser("add", help="add a case (hotline must be a valid E.164 number for the region)")
    for name in ("customer", "company", "hotline", "region", "type", "reference", "summary", "owed", "opened"):
        a.add_argument("--" + name, required=True)
    a.add_argument("--locale", default="en-US"); a.add_argument("--timezone", default="UTC"); a.add_argument("--ivr", default="")
    a.set_defaults(fn=cmd_add)
    au = sub.add_parser("authorize", help="record which exact number may be dialled live for a case, until when, how often")
    au.add_argument("case"); au.add_argument("--hotline", required=True, help="repeat the case hotline exactly")
    au.add_argument("--until", required=True, help="expiry date YYYY-MM-DD"); au.add_argument("--max-calls", type=int, default=policy.MAX_TOTAL_CALLS)
    au.add_argument("--unattended", action="store_true", help="permit scheduled runs with --authorization")
    au.set_defaults(fn=cmd_authorize)
    sub.add_parser("status", help="list cases and whether each may be called now").set_defaults(fn=cmd_status)
    pl = sub.add_parser("plan", help="print the exact call task without calling"); pl.add_argument("case"); pl.add_argument("--force", action="store_true"); pl.set_defaults(fn=cmd_plan)
    r = sub.add_parser("run", help="run one chase cycle"); r.add_argument("case")
    r.add_argument("--mode", choices=engine.MODES, default="preview"); r.add_argument("--scenario", default=None, help="fixture scenario name")
    r.add_argument("--force", action="store_true", help="ignore suppression reasons (preview and fixture only)")
    r.add_argument("--yes", action="store_true", help="confirm one interactive live call")
    r.add_argument("--authorization", default=None, help="scheduled live run: path to the authorization record written by `authorize --unattended`")
    r.set_defaults(fn=cmd_run)
    rc = sub.add_parser("reconcile", help="fold in a call that was sent but never recorded, or clear it"); rc.add_argument("case")
    rc.add_argument("--call-id", default=None); rc.add_argument("--clear", action="store_true"); rc.set_defaults(fn=cmd_reconcile)
    d = sub.add_parser("decide", help="record the customer's decision on a pending question"); d.add_argument("case"); d.add_argument("decision")
    d.add_argument("--close", choices=["resolve", "abandon"], default=None); d.set_defaults(fn=cmd_decide)
    e = sub.add_parser("evidence", help="write the evidence pack"); e.add_argument("case"); e.add_argument("--out", default=None); e.set_defaults(fn=cmd_evidence)
    s = sub.add_parser("serve", help="local dashboard (loopback only)"); s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8765); s.set_defaults(fn=cmd_serve)
    f = sub.add_parser("fake-server", help="run the fake CALL-E API for manual testing"); f.add_argument("--scenario", default="first_call_commitment")
    f.add_argument("--host", default="127.0.0.1"); f.add_argument("--port", type=int, default=8791); f.set_defaults(fn=cmd_fake_server)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
