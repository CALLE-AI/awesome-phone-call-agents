"""Sticker's command line.

Four commands, and the split between them is the safety model:

    sticker find     reads the federal pharmacy registry. Never dials.
    sticker cost     reads the federal acquisition cost. Never dials.
    sticker survey   asks the price. Simulated unless argued into being live.
    sticker doctor   checks the API key without spending a call.

`find` deliberately does not feed `survey`. It writes a candidate list for a person to
read, and live calling only ever dials numbers a person has moved into an authorized
file. A public business listing is not permission to call it.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import httpx

from .call_design import DrugRequest
from .calle import DEFAULT_BASE_URL, CalleTransport
from .nadac import NadacError, lookup
from .pharmacies import Pharmacy, find
from .report import render_text
from .safety import SafetyError, authorize_destinations, is_fictional, mask
from .simulation import SIMULATED_BASE_URL, SIMULATED_POLL_SECONDS, SimulatedCalle
from .survey import run_survey

CONFIRM_TOKEN = "PLACE-REAL-CALLS"
LIVE_ENV = "STICKER_LIVE_CALLS_ENABLED"
KEY_ENV = "CALLE_API_KEY"
BASE_ENV = "CALLE_BASE_URL"


def _drug(args: argparse.Namespace) -> DrugRequest:
    return DrugRequest(
        name=args.drug, strength=args.strength, form=args.form, quantity=args.quantity
    )


def _read_authorized(path: Path) -> frozenset[str]:
    """Load the destinations a person has explicitly approved for this run."""
    if not path.exists():
        raise SafetyError(
            f"No authorized destinations file at {path}. Live calling needs one. "
            "Run `sticker find` first, read the candidates, and copy the numbers you "
            "actually want called into that file, one per line."
        )
    # Everything after a `#` is a comment, not part of the number. `sticker find --out`
    # writes the pharmacy name after each number precisely so the person editing the file
    # can tell the rows apart, so the reader has to strip those or the tool rejects its
    # own documented output.
    numbers = [
        stripped
        for line in path.read_text(encoding="utf-8").splitlines()
        if (stripped := line.split("#", 1)[0].strip())
    ]
    return frozenset(numbers)


# -- commands -------------------------------------------------------------------


def cmd_find(args: argparse.Namespace) -> int:
    pharmacies = find(args.zip, limit=args.limit)
    if not pharmacies:
        print(f"No community pharmacies found in {args.zip}.")
        return 1

    print(f"{len(pharmacies)} licensed community pharmacies in {args.zip} (source: NPPES).")
    print("Nothing has been called. Numbers are masked here; use --out to write the")
    print("exact list to a file you then edit into your authorized destinations.\n")
    # The terminal is a report surface, and this one scrolls through a screen share or a
    # demo recording. The exact numbers of real businesses belong only in the file the
    # operator is about to edit, which is the one place they are actually needed.
    for p in pharmacies:
        print(f"  {mask(p.e164):<16} {p.name[:40]:<42} {p.address[:34]}")
    if args.out:
        Path(args.out).write_text(
            "# Candidates from NPPES. Delete every line you do not want dialled.\n"
            + "\n".join(f"{p.e164}  # {p.name}" for p in pharmacies)
            + "\n",
            encoding="utf-8",
        )
        print(f"\nExact numbers written to {args.out}. It authorizes nothing until you edit it.")
    return 0


def cmd_cost(args: argparse.Namespace) -> int:
    drug = _drug(args)
    try:
        row = lookup(drug.nadac_prefix())
    except NadacError as exc:
        print(f"{exc}", file=sys.stderr)
        return 1
    print(row.citation())
    print(
        f"Pharmacies nationally paid about ${row.cost_for(drug.quantity):.2f} for "
        f"{drug.quantity} {drug.form}s."
    )
    print("This is CMS's national average, not any one pharmacy's invoice.")
    print(row.source_url)
    return 0


def cmd_survey(args: argparse.Namespace) -> int:
    drug = _drug(args)

    if not args.live:
        # The default path. No key, no network to CALL-E, no phone rings.
        sim = SimulatedCalle()
        pharmacies = _fixture_pharmacies(args.count)
        transport = CalleTransport(
            api_key="sticker-simulated-key",
            base_url=SIMULATED_BASE_URL,
            transport=sim.transport(),
            poll_interval=SIMULATED_POLL_SECONDS,
        )
        survey = asyncio.run(
            run_survey(
                drug=drug,
                postal_code=args.zip,
                pharmacies=pharmacies,
                transport=transport,
                caller_org=args.org,
                live=False,
                fetch_nadac=not args.offline,
            )
        )
        print(render_text(survey))
        return 0

    # -- everything below this line can make a telephone ring -------------------
    if os.environ.get(LIVE_ENV, "").lower() != "true":
        print(f"Refusing: set {LIVE_ENV}=true to enable live calling.", file=sys.stderr)
        return 2
    if args.confirm != CONFIRM_TOKEN:
        print(f"Refusing: pass --confirm {CONFIRM_TOKEN} to place real calls.", file=sys.stderr)
        return 2
    api_key = os.environ.get(KEY_ENV, "")
    if not api_key:
        print(f"Refusing: {KEY_ENV} is not set.", file=sys.stderr)
        return 2

    try:
        allowlist = _read_authorized(Path(args.authorized))
        pharmacies = _load_pharmacies_for(allowlist, args.zip)
        authorize_destinations([p.e164 for p in pharmacies], allowlist)
    except SafetyError as exc:
        print(f"Refusing: {exc}", file=sys.stderr)
        return 2

    # A ceiling of zero authorizes zero calls. Treating it as "no limit" would turn the
    # most cautious thing an operator can type into the least cautious thing the tool can
    # do, which is the wrong way round for a control whose only job is to say "no more
    # than this".
    if args.max_calls < 0:
        print("Refusing: --max-calls cannot be negative.", file=sys.stderr)
        return 2
    if len(pharmacies) > args.max_calls:
        print(
            f"Refusing: {len(pharmacies)} authorized numbers exceeds --max-calls "
            f"{args.max_calls}. Raise the ceiling deliberately.",
            file=sys.stderr,
        )
        return 2

    # No cost estimate. The per-call price is published nowhere this project can cite, and
    # a number invented for a confirmation prompt is worse than no number.
    print(f"About to place {len(pharmacies)} real calls.")
    for p in pharmacies:
        print(f"  {mask(p.e164)}  {p.name}")

    transport = CalleTransport(
        api_key=api_key, base_url=os.environ.get(BASE_ENV, DEFAULT_BASE_URL)
    )
    survey = asyncio.run(
        run_survey(
            drug=drug,
            postal_code=args.zip,
            pharmacies=pharmacies,
            transport=transport,
            caller_org=args.org,
            live=True,
            concurrency=args.concurrency,
        )
    )
    print()
    print(render_text(survey))
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Confirm the key authenticates without spending a call.

    Reads a call id that cannot exist. `not_found` proves the key was accepted; only an
    auth failure is a credential problem. This is the cheapest way to tell a bad key from
    an empty balance.
    """
    api_key = os.environ.get(KEY_ENV, "")
    if not api_key:
        print(f"{KEY_ENV} is not set.", file=sys.stderr)
        return 2
    base = os.environ.get(BASE_ENV, DEFAULT_BASE_URL)

    async def probe() -> int:
        async with CalleTransport(api_key=api_key, base_url=base) as transport:
            try:
                await transport.get("call_sticker_credential_probe")
            except Exception as exc:
                text = str(exc)
                if "404" in text or "not_found" in text:
                    print("API key accepted.")
                    return 0
                if "401" in text or "403" in text:
                    print("API key rejected.", file=sys.stderr)
                    return 2
                print(f"Could not reach CALL-E: {text}", file=sys.stderr)
                return 1
            print("API key accepted.")
            return 0

    return asyncio.run(probe())


# -- fixtures -------------------------------------------------------------------


def _fixture_pharmacies(count: int) -> list[Pharmacy]:
    """Invented pharmacies on numbers reserved for fiction (NANP 555-0100..0199)."""
    names = [
        ("Cedar Street Pharmacy", "Springfield"),
        ("Northgate Drug", "Springfield"),
        ("Harbour Chemists", "Riverton"),
        ("Oak & Vine Pharmacy", "Springfield"),
        ("Lakeside Community Drug", "Riverton"),
        ("Fifth Avenue Apothecary", "Springfield"),
        ("Union Square Pharmacy", "Riverton"),
        ("Greenfield Family Drug", "Springfield"),
        ("Bellview Pharmacy", "Riverton"),
        ("Old Mill Drug Store", "Springfield"),
    ]
    out: list[Pharmacy] = []
    for index, (name, city) in enumerate(names[: max(1, count)]):
        number = f"+1202555{100 + index:04d}"[:12]
        out.append(
            Pharmacy(
                npi=f"000000{index:04d}",
                name=name,
                phone=f"202-555-{100 + index:04d}",
                address=f"{100 + index * 7} Example Street",
                city=city,
                state="EX",
                postal_code="00000",
            )
        )
    return out


def _load_pharmacies_for(allowlist: frozenset[str], postal_code: str) -> list[Pharmacy]:
    """Resolve authorized numbers back to registry records, for readable output."""
    known = {p.e164: p for p in find(postal_code, limit=200)}
    out: list[Pharmacy] = []
    for number in sorted(allowlist):
        if number in known:
            out.append(known[number])
        else:
            out.append(
                Pharmacy(
                    npi="",
                    name="(authorized number not in this ZIP's registry results)",
                    phone=number,
                    address="",
                    city="",
                    state="",
                    postal_code=postal_code,
                )
            )
    return out


# -- wiring ---------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sticker",
        description="Ask pharmacies what a prescription actually costs in cash.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def drug_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--drug", default="metformin hcl", help="Drug name, e.g. 'metformin hcl'")
        p.add_argument("--strength", default="500 mg")
        p.add_argument("--form", default="tablet")
        p.add_argument("--quantity", type=int, default=30)

    p_find = sub.add_parser("find", help="List licensed pharmacies near a ZIP. Places no calls.")
    p_find.add_argument("--zip", required=True)
    p_find.add_argument("--limit", type=int, default=25)
    p_find.add_argument("--out", help="Write a candidate list here for you to edit.")
    p_find.set_defaults(func=cmd_find)

    p_cost = sub.add_parser("cost", help="National average acquisition cost, per CMS NADAC.")
    drug_args(p_cost)
    p_cost.set_defaults(func=cmd_cost)

    p_survey = sub.add_parser("survey", help="Run the price survey. Simulated by default.")
    drug_args(p_survey)
    p_survey.add_argument("--zip", default="00000")
    p_survey.add_argument("--org", default="an independent price comparison")
    p_survey.add_argument("--count", type=int, default=10, help="Simulated pharmacies to call.")
    p_survey.add_argument("--offline", action="store_true", help="Skip the CMS lookup too.")
    p_survey.add_argument("--live", action="store_true", help="Place real calls.")
    p_survey.add_argument("--confirm", default="", help=f"Must be {CONFIRM_TOKEN} with --live.")
    p_survey.add_argument("--authorized", default="authorized_destinations.txt")
    p_survey.add_argument("--max-calls", type=int, default=25)
    p_survey.add_argument("--concurrency", type=int, default=3)
    p_survey.set_defaults(func=cmd_survey)

    p_doctor = sub.add_parser("doctor", help="Check the API key without spending a call.")
    p_doctor.set_defaults(func=cmd_doctor)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except SafetyError as exc:
        print(f"Refusing: {exc}", file=sys.stderr)
        return 2
    except httpx.HTTPError as exc:
        print(f"Network error: {type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
