"""Command line entry point. Preview and fixture modes place no call; live mode dials exactly once per approval."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import engine
from .analysis import analyze_case
from .calle_client import OFFICIAL_ORIGIN, CalleClient, CalleError, FakeCalleServer, friendly_error
from .call_plan import build_plan
from .display import mask_output
from .models import Store, mask_phone, new_case

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

def load_env_chain() -> None:
    """Load CALLE_API_KEY and friends from the app dir, the current dir, then
    ancestors up to the repo root, without overriding real environment variables."""
    load_env(os.path.join(APP_DIR, ".env"))
    here = os.path.abspath(os.getcwd())
    for _ in range(5):
        load_env(os.path.join(here, ".env"))
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent


def load_case(args: argparse.Namespace) -> dict:
    store = Store(args.data)
    if not store.exists():
        print(f"no case in {args.data}; run `init-demo` first", file=sys.stderr)
        raise SystemExit(2)
    return store.load()


def cmd_init_demo(args: argparse.Namespace) -> int:
    with open(os.path.join(APP_DIR, "examples", "demo-case.json"), "r", encoding="utf-8") as f:
        seed = json.load(f)
    seed.pop("synthetic", None)
    seed.pop("note", None)
    case = new_case(**seed)
    Store(args.data).save(case)
    print(f"SYNTHETIC DEMO — NOT A REAL BOOKING\ncreated {case['id']}  {case['airline']} {case['flight_no']}  hotline {mask_phone(case['airline_hotline'])}")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    case = mask_output(load_case(args))
    print(f"SYNTHETIC DEMO — NOT A REAL BOOKING\n{case['passenger_name']} | {case['airline']} {case['flight_no']} "
          f"{case['origin']} -> {case['destination']} | booking {case['booking_ref']} | {case['flight_status']} | status {case['status']}")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    case = load_case(args)
    analysis = analyze_case(case)
    print(json.dumps(mask_output(analysis), indent=2))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    case = load_case(args)
    analysis = analyze_case(case)
    plan = build_plan(case, analysis["missing_information"])
    print("PREVIEW ONLY. Nothing will be sent.")
    print(json.dumps(mask_output(plan), indent=2))
    return 0


def _print_outcome(case: dict, res: dict, mode: str) -> int:
    case, res = mask_output(case), mask_output(res)
    if not res.get("placed"):
        print(f"NO CALL: {res.get('reason')}")
        return 2
    call = res["call"]
    print(f"call {call['id']} [{mode}] status={res.get('call_status')} case now {case['status']}")
    for row in case.get("before_after", []):
        print(f"  {row['field']}: {row['before']}  ->  {row['after']}")
    for c in case.get("representative_commitments", []):
        print(f"  commitment: {c}")
    if case.get("recommended_next_action"):
        print(f"  {case['recommended_next_action']}")
    if call.get("result_problems"):
        print(f"  result rejected: {', '.join(call['result_problems'])}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    store = Store(args.data)
    case = load_case(args)
    if args.mode == "preview":
        res = mask_output(engine.preview(case))
        print(f"PREVIEW ONLY. Would dial {res['masked_destination']} (region {res['region']}). Nothing was sent.")
        print(f"purpose: {res['plan']['purpose']}")
        for o in res["plan"]["objectives"]:
            print(f"  objective: {o}")
        for c in res["plan"]["constraints"]:
            print(f"  restriction: {c}")
        print(f"result_schema keys: {', '.join(res['result_schema']['required'])}")
        return 0
    fake = None
    api_key_present = False
    allowlist = None
    if args.mode == "fixture":
        fake = FakeCalleServer(FIXTURES).start()
        client = CalleClient("fixture-key", fake.base_url, allow_local_fake=True)
    else:
        if not args.approve:
            print("REFUSED: live mode places a real phone call. Re-run with --approve plus --hotline repeating the case hotline exactly.", file=sys.stderr)
            return 3
        if args.hotline != case["airline_hotline"]:
            print(f"REFUSED: --hotline must repeat the case hotline exactly ({mask_phone(case['airline_hotline'])}); this is the authorization.", file=sys.stderr)
            return 3
        load_env_chain()
        override = os.environ.get("CALLE_BASE_URL")
        if override and override.rstrip("/") != OFFICIAL_ORIGIN:
            print(f"REFUSED: CALLE_BASE_URL is not the official origin {OFFICIAL_ORIGIN}; unset it", file=sys.stderr)
            return 3
        allowlist = os.environ.get("CLAIMCALL_ALLOWLIST", "")
        api_key_present = bool(os.environ.get("CALLE_API_KEY", ""))
        try:
            client = CalleClient(os.environ.get("CALLE_API_KEY", ""), OFFICIAL_ORIGIN)
        except CalleError as e:
            print(f"REFUSED: {friendly_error(e)}", file=sys.stderr)
            return 3
    try:
        res = engine.run(case, args.mode, client=client, approved=args.approve,
                         allowlist=allowlist, api_key_present=api_key_present or args.mode == "fixture")
    except CalleError as e:
        print(f"ERROR: {friendly_error(e)}", file=sys.stderr)
        return 4
    finally:
        if fake:
            fake.stop()
    if res.get("placed"):
        store.save(case)
    return _print_outcome(case, res, args.mode)


def cmd_serve(args: argparse.Namespace) -> int:
    from .dashboard import serve
    return serve(args.data, args.host, args.port, FIXTURES, allow_live=args.allow_live)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="claimcall", description=__doc__)
    p.add_argument("--data", default=os.environ.get("CLAIMCALL_DATA", os.path.join(os.getcwd(), "data")), help="case store directory")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-demo", help="seed the synthetic demo case (no call)").set_defaults(fn=cmd_init_demo)
    sub.add_parser("show", help="show the disruption case").set_defaults(fn=cmd_show)
    sub.add_parser("analyze", help="print missing information and the call recommendation").set_defaults(fn=cmd_analyze)
    sub.add_parser("plan", help="print the bounded call plan without calling").set_defaults(fn=cmd_plan)
    r = sub.add_parser("run", help="run one resolution cycle")
    r.add_argument("--mode", choices=engine.MODES, default="preview")
    r.add_argument("--approve", action="store_true", help="explicit human approval for one fixture or live call")
    r.add_argument("--hotline", default=None, help="live mode: repeat the case hotline exactly to authorise the destination")
    r.set_defaults(fn=cmd_run)
    s = sub.add_parser("serve", help="local dashboard (loopback only)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8766)
    s.add_argument("--allow-live", action="store_true", help="permit approved live calls from the dashboard (requires CALLE_API_KEY)")
    s.set_defaults(fn=cmd_serve)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
