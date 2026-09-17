#!/usr/bin/env python3
"""VaxCheck - school immunisation consent and screening calls with CALL-E.

Four modes, in increasing order of consequence:

  (default)     preview   - render the plan and schemas. No network.
  --mock        replay    - run fixtures through the real triage logic. No network.
  --preflight   validate  - real CALL-E plan_call. Real API, no phone call.
  --execute     live      - real outbound phone calls. Requires --confirm-consent.

Run with no flags first. Always.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from vaxcheck import preview, report  # noqa: E402
from vaxcheck.classify import records_from_calls  # noqa: E402
from vaxcheck.mock_client import build_calls, load_fixture  # noqa: E402
from vaxcheck.roster import RosterError, load  # noqa: E402
from vaxcheck.triage import MIN_CONFIDENCE  # noqa: E402

DEFAULT_FIXTURES = [
    "conversation_consent_school.json",
    "conversation_private_provider.json",
    "conversation_allergy_severe.json",
    "conversation_decline.json",
    "conversation_unsure.json",
    "conversation_voicemail.json",
]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="client.py",
        description="School immunisation consent and screening calls with CALL-E.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--roster", required=True, help="path to a roster JSON file")
    p.add_argument("--out", help="write the JSON result to this path (roster, preflight or doctor)")
    p.add_argument("--html", help="also write the immunisation-day board as a self-contained HTML page")
    p.add_argument(
        "--min-confidence",
        type=float,
        default=MIN_CONFIDENCE,
        help=f"confidence below which a record needs nurse review (default {MIN_CONFIDENCE})",
    )
    p.add_argument("--json", action="store_true", help="print JSON instead of the text roster")

    mode = p.add_argument_group("modes")
    mode.add_argument("--mock", action="store_true", help="replay fixtures; no network")
    mode.add_argument(
        "--fixture",
        action="append",
        help="fixture name or path for --mock; repeat to vary across students",
    )
    mode.add_argument(
        "--doctor",
        action="store_true",
        help="check CLI auth, SDK, API key and region corridor against the live service",
    )
    mode.add_argument(
        "--preflight",
        action="store_true",
        help="real CALL-E plan_call to validate the roster; never dials",
    )
    mode.add_argument(
        "--preflight-limit",
        type=int,
        default=3,
        help="how many students to preflight (default 3)",
    )
    mode.add_argument(
        "--execute", action="store_true", help="place REAL phone calls"
    )
    mode.add_argument(
        "--confirm-consent",
        action="store_true",
        help="required with --execute: you confirm you are authorised to call these guardians",
    )
    mode.add_argument("--resume", metavar="CALL_ID", help="fetch an existing call instead of creating one; requires --student")
    mode.add_argument("--student", metavar="STUDENT_ID", help="with --resume: the roster student this call belongs to")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        session, students = load(args.roster)
    except RosterError as exc:
        print(f"roster error: {exc}", file=sys.stderr)
        return 2

    # ---- doctor: live read-only environment check --------------------------
    if args.doctor:
        from vaxcheck import doctor

        checks = doctor.run(session, students[0] if students else None)
        print(doctor.render(checks))
        if args.out:
            Path(args.out).write_text(
                json.dumps([{"name": c.name, "status": c.status, "detail": c.detail} for c in checks], indent=2),
                encoding="utf-8",
            )
            print(f"wrote {args.out}")
        return 0 if not any(c.status == doctor.FAIL for c in checks) else 1

    # ---- preflight: real CALL-E API, no dialling ---------------------------
    if args.preflight:
        from vaxcheck.preflight import PreflightError, preflight_roster

        print(
            f"Preflighting {min(args.preflight_limit, len(students))} of "
            f"{len(students)} students against CALL-E ({session.region}/"
            f"{session.language}). This calls plan_call and does NOT dial.\n"
        )
        try:
            results = preflight_roster(session, students, limit=args.preflight_limit)
        except PreflightError as exc:
            print(f"preflight failed: {exc}", file=sys.stderr)
            return 3

        ready = sum(1 for r in results if r.ready)
        for r in results:
            mark = "OK " if r.ready else "BLOCKED"
            print(f"  [{r.student_id}] {r.masked_phone}  {mark}")
            for b in r.blockers:
                print(f"        - {b}")
        print(f"\n{ready}/{len(results)} ready to run.")
        if args.out:
            Path(args.out).write_text(
                json.dumps([r.to_dict() for r in results], indent=2), encoding="utf-8"
            )
            print(f"wrote {args.out}")
        return 0 if ready == len(results) else 1

    # ---- live execution ----------------------------------------------------
    if args.execute or args.resume:
        from vaxcheck.live_client import LiveClientError, bind_resumed_call, fetch_call, run_session

        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            print(
                "CALLE_API_KEY is not set. Get a key at "
                "https://dashboard.heycall-e.com/account/api-keys",
                file=sys.stderr,
            )
            return 2
        base_url = os.environ.get("CALLE_BASE_URL")

        try:
            if args.resume:
                if not args.student:
                    print("--resume needs --student <STUDENT_ID> so the result is bound to one roster row.", file=sys.stderr)
                    return 2
                match = next((st for st in students if st.student_id == args.student), None)
                if match is None:
                    print(f"student {args.student} is not in this roster.", file=sys.stderr)
                    return 2
                print(f"Resuming call {args.resume} for {args.student} (no new calls placed).")
                call = bind_resumed_call(
                    fetch_call(args.resume, api_key=api_key, base_url=base_url), session, match
                )
                pairs = [(match, call)]
            else:
                if not args.confirm_consent:
                    print(
                        "--execute places REAL phone calls to the guardians in this "
                        "roster.\nRe-run with --confirm-consent to confirm you are "
                        "authorised to call them.",
                        file=sys.stderr,
                    )
                    return 2
                print(
                    f"Placing real calls for {len(students)} guardians "
                    f"({session.region}/{session.language}), one task each.\n"
                )
                pairs = run_session(
                    session,
                    students,
                    api_key=api_key,
                    base_url=base_url,
                    on_progress=lambda st: print(
                        f"  calling {st.student_name} via {st.masked_phone} ..."
                    ),
                )
                print()
        except LiveClientError as exc:
            print(f"live call failed: {exc}", file=sys.stderr)
            return 3

    # ---- mock replay -------------------------------------------------------
    elif args.mock:
        names = args.fixture or DEFAULT_FIXTURES
        try:
            fixtures = [load_fixture(n) for n in names]
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            print(f"fixture error: {exc}", file=sys.stderr)
            return 2
        pairs = build_calls(students, fixtures)
        print("MOCK REPLAY - no phone call was placed, no network was used.\n")

    # ---- preview (default) -------------------------------------------------
    else:
        print(preview.render(session, students))
        return 0

    records = records_from_calls(pairs, min_confidence=args.min_confidence)
    if args.json:
        print(report.dumps(records, session))
    else:
        print(report.render(records, session))

    if args.out:
        Path(args.out).write_text(report.dumps(records, session), encoding="utf-8")
        print(f"\nwrote {args.out}")
    if args.html:
        from vaxcheck import board

        Path(args.html).write_text(board.render(report.to_json(records, session)), encoding="utf-8")
        print(f"wrote {args.html}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
