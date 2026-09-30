from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import decide as decide_mod
from . import resolve as resolve_mod
from .audit import build_audit_report, render_terminal_report
from .case import Case
from .html_report import render_html_report, render_index_html
from .safety import redact_value
from .verify_call import SecurityEventLog, place_verification_call


def _cmd_submit(args: argparse.Namespace) -> int:
    case_data = json.loads(Path(args.file).read_text(encoding="utf-8"))
    try:
        case = Case.from_dict(case_data)
    except ValueError as exc:
        raise SystemExit(f"invalid case file {args.file}: {exc}") from exc
    security_log = SecurityEventLog(Path(args.security_log))

    if args.live and not args.confirm_live:
        raise SystemExit("--live requires --confirm-live (explicit, separate confirmation)")

    client_factory = None
    if args.live:
        def client_factory():  # noqa: ANN202
            from calle import CalleClient  # imported lazily: not needed for dry runs

            api_key = os.environ.get("CALLE_API_KEY")
            if not api_key:
                raise SystemExit("CALLE_API_KEY is required for --live")
            return CalleClient(api_key=api_key)

    outcome = place_verification_call(
        case, live=args.live, security_log=security_log, client_factory=client_factory
    )

    mode_label = "LIVE" if args.live else "DRY RUN — nothing is dialed"
    print(f"ringfence case submit · case={case.case_id} · {mode_label}\n")
    print(f"  dial target : {outcome.dialed_phone_masked}")
    print(f"  status      : {outcome.status}")
    if outcome.call_id:
        print(f"  call_id     : {outcome.call_id}")
    if outcome.detail:
        print(f"  detail      : {outcome.detail}")
    if security_log.events:
        print(
            f"\n  SECURITY EVENT recorded ({args.security_log}): the request "
            "supplied a callback number; it was never dialed."
        )
    return 0


def _cmd_resolve(args: argparse.Namespace) -> int:
    records: list[tuple[str, dict]] = []
    fixtures_dir = Path(args.from_fixtures)
    for path in sorted(fixtures_dir.glob("*.json")):
        records.append((path.stem, json.loads(path.read_text(encoding="utf-8"))))

    print(f"ringfence resolve · {len(records)} case(s)\n")
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out_f:
        for name, record in records:
            try:
                resolution = resolve_mod.classify(
                    record["call"], record.get("attempts", []), record.get("events", [])
                )
                disposition = decide_mod.decide(resolution, record.get("signals", {}))
            except (KeyError, TypeError) as exc:
                # One malformed fixture must not silently swallow every
                # fixture after it in the batch.
                print(f"  {name:<40} ERROR: malformed record ({exc})")
                out_f.write(json.dumps({"case_id": name, "error": str(exc)}, ensure_ascii=False) + "\n")
                continue

            print(f"  {name:<40} outcome={resolution.outcome:<32} -> {disposition.disposition}")
            for reason in disposition.reasons:
                print(f"      - {reason}")

            report = {
                "case_id": record.get("case", {}).get("case_id", name),
                "outcome": resolution.outcome,
                "outcome_confidence": resolution.confidence,
                "outcome_evidence": resolution.evidence,
                "disposition": disposition.disposition,
                "disposition_reasons": disposition.reasons,
            }
            out_f.write(json.dumps(redact_value(report), ensure_ascii=False) + "\n")

    print(f"\naudit report -> {out_path}")
    return 0


def _cmd_audit(args: argparse.Namespace) -> int:
    """Print (and optionally export) the full evidence-trail audit report
    for one {case, call, attempts, events, signals} record -- the same
    shape as fixtures/*.json. Real fraud-ops compliance requirement, not
    decoration: what was asked, what was answered, which red flags fired,
    and why the disposition was reached.
    """
    record = json.loads(Path(args.file).read_text(encoding="utf-8"))
    report = build_audit_report(record)
    print(render_terminal_report(report))

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nJSON audit report -> {out_path}")

    if args.html:
        html_path = Path(args.html)
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_text(render_html_report(report), encoding="utf-8")
        print(f"HTML case report -> {html_path}")

    return 0


def _cmd_report_index(args: argparse.Namespace) -> int:
    """Build a static, dependency-free HTML case index (no server, no auth)
    from a directory of previously exported JSON audit reports."""
    reports_dir = Path(args.from_reports)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    reports = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(reports_dir.glob("*.json"))
    ]
    for report in reports:
        (out_dir / f"{report['case_id']}.html").write_text(
            render_html_report(report), encoding="utf-8"
        )
    (out_dir / "index.html").write_text(render_index_html(reports), encoding="utf-8")

    print(f"wrote {len(reports)} case page(s) + index.html -> {out_dir}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ringfence")
    sub = parser.add_subparsers(dest="command", required=True)

    case_p = sub.add_parser("case", help="Submit or resolve a fraud-verification case.")
    case_sub = case_p.add_subparsers(dest="case_command", required=True)

    submit_p = case_sub.add_parser("submit", help="Submit a case and place its verification call (dry-run by default).")
    submit_p.add_argument("--file", required=True, help="Path to a case JSON file (see example_case.json).")
    submit_p.add_argument("--live", action="store_true", help="Place a real call. Requires --confirm-live.")
    submit_p.add_argument("--confirm-live", action="store_true", help="Explicit second confirmation required alongside --live.")
    submit_p.add_argument("--security-log", default="results/security_events.jsonl")
    submit_p.set_defaults(func=_cmd_submit)

    resolve_p = case_sub.add_parser("resolve", help="Classify outcome + decide disposition for fixture-shaped case records.")
    resolve_p.add_argument("--from-fixtures", required=True, help="Directory of {case,call,attempts,events,signals} JSON files.")
    resolve_p.add_argument("--out", default="results/case_dispositions.jsonl")
    resolve_p.set_defaults(func=_cmd_resolve)

    audit_p = case_sub.add_parser("audit", help="Print/export the full evidence-trail audit report for one case record.")
    audit_p.add_argument("--file", required=True, help="Path to a {case,call,attempts,events,signals} JSON record (fixture format).")
    audit_p.add_argument("--out", default=None, help="Optional path to write the JSON audit report.")
    audit_p.add_argument("--html", default=None, help="Optional path to also write a static HTML case-report page.")
    audit_p.set_defaults(func=_cmd_audit)

    report_index_p = case_sub.add_parser("report-index", help="Build a static HTML case index from a directory of exported JSON audit reports.")
    report_index_p.add_argument("--from-reports", required=True, help="Directory of JSON audit reports (from `case audit --out`).")
    report_index_p.add_argument("--out-dir", default="results/audit_html")
    report_index_p.set_defaults(func=_cmd_report_index)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
