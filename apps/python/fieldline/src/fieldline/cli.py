"""FieldLine CLI.

    fieldline demo [--scenario full|safe|duress] [--fast]   zero-key demo
    fieldline start examples/trip.yaml                      live monitoring
    fieldline checkin-now examples/trip.yaml                one live test call
    fieldline end                                           cancel the active trip
    fieldline report                                        show the latest incident brief
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rich.console import Console
from rich.markdown import Markdown

from .calle_client import DemoCalleDispatcher, LiveCalleDispatcher
from .config import Settings, get_settings
from .demo_data import SCENARIOS, demo_trip_plan
from .engine import DemoWaiter, LiveWaiter, TripEngine
from .render import RichRenderer
from .schemas import TripPlanError, load_trip_plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fieldline", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_demo = sub.add_parser("demo", help="run the scripted offline demo (no account, no keys)")
    p_demo.add_argument("--scenario", choices=sorted(SCENARIOS), default="full")
    p_demo.add_argument("--fast", action="store_true", help="skip pacing delays")

    p_start = sub.add_parser("start", help="LIVE: monitor a trip plan (places real calls)")
    p_start.add_argument("plan", help="path to a trip plan YAML")
    p_start.add_argument("--yes", action="store_true", help="skip the live-call confirmation")

    p_now = sub.add_parser("checkin-now", help="LIVE: place one check-in call immediately")
    p_now.add_argument("plan", help="path to a trip plan YAML")
    p_now.add_argument("--yes", action="store_true", help="skip the live-call confirmation")

    sub.add_parser("end", help="cancel the active trip (stops future calls)")
    sub.add_parser("report", help="print the most recent incident brief")

    args = parser.parse_args(argv)
    settings = get_settings()

    if args.command == "demo":
        return cmd_demo(settings, args.scenario, fast=args.fast or settings.fast)
    if args.command == "start":
        return cmd_live(settings, args.plan, args.yes, single=False)
    if args.command == "checkin-now":
        return cmd_live(settings, args.plan, args.yes, single=True)
    if args.command == "end":
        return cmd_end(settings)
    if args.command == "report":
        return cmd_report(settings)
    return 2


def cmd_demo(settings: Settings, scenario: str, fast: bool) -> int:
    renderer = RichRenderer()
    dispatcher = DemoCalleDispatcher(
        SCENARIOS[scenario],
        on_turn=renderer.turn,
        turn_delay=0.0 if fast else 1.15,
    )
    engine = TripEngine(
        plan=demo_trip_plan(),
        dispatcher=dispatcher,
        renderer=renderer,
        home=settings.home,
        demo=True,
        waiter=DemoWaiter(fast=fast),
    )
    engine.run()
    return 0


def cmd_live(settings: Settings, plan_path: str, yes: bool, single: bool) -> int:
    console = Console()
    if settings.demo or not settings.api_key:
        console.print(
            "[yellow3]Live mode needs a CALL-E API key.[/]\n"
            "1. Create an account: https://www.heycall-e.com/ (20 free calls)\n"
            "2. Create a key:      https://dashboard.heycall-e.com/account/api-keys\n"
            "3. Put it in .env:    CALLE_API_KEY=... (and leave FIELDLINE_DEMO unset)\n"
            "Meanwhile, try the offline demo:  uv run fieldline demo"
        )
        return 2
    try:
        plan = load_trip_plan(plan_path)
    except TripPlanError as exc:
        console.print(f"[red]Invalid trip plan:[/] {exc}")
        return 2

    # Consent gate: never place real calls without an explicit go-ahead.
    if not yes:
        console.print("[bold red]LIVE MODE[/] — real phone calls will be placed to the numbers in the plan.")
        if input("Type LIVE to continue: ").strip() != "LIVE":
            console.print("Aborted; no calls placed.")
            return 1

    cancel_file = settings.home / "cancel"
    cancel_file.unlink(missing_ok=True)
    engine = TripEngine(
        plan=plan,
        dispatcher=LiveCalleDispatcher(api_key=settings.api_key, base_url=settings.base_url),
        renderer=RichRenderer(),
        home=settings.home,
        demo=False,
        waiter=LiveWaiter(cancel_file),
    )
    if single:
        engine.run_single_checkin()
    else:
        engine.run()
    return 0


def cmd_end(settings: Settings) -> int:
    settings.home.mkdir(parents=True, exist_ok=True)
    (settings.home / "cancel").touch()
    Console().print("Cancel signal set — the active trip will stop before its next call.")
    return 0


def cmd_report(settings: Settings) -> int:
    console = Console()
    reports = sorted((settings.home / "reports").glob("incident-*.md"))
    if not reports:
        console.print("No incident briefs yet. Run: uv run fieldline demo")
        return 1
    latest = reports[-1]
    console.print(f"[dim]{latest}[/]\n")
    console.print(Markdown(latest.read_text(encoding="utf-8")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
