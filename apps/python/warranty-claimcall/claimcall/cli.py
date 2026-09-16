"""ClaimCall CLI.

    claimcall preview   --claim fixtures/eligible-claim.json
    claimcall run       --claim fixtures/eligible-claim.json
    claimcall run       --claim fixtures/eligible-claim.json --live --confirm <hash>
    claimcall reconcile --call-id <id> --claim fixtures/eligible-claim.json
    claimcall verify    --claim fixtures/eligible-claim.json --result <file.json>
    claimcall hash-number +15005550006

Everything defaults to a dry run. `--live` is the only thing in this tool that
can cause a phone to ring, and it needs three more conditions besides the flag.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from claimcall_core import hash_phone, mask_phone

from . import dispatcher, safety
from . import manifest as manifest_mod
from . import reconcile as reconcile_mod
from .schemas import ClaimFile

FIXTURES = Path(__file__).resolve().parent / "fixtures"
EXIT_OK, EXIT_HELD, EXIT_ERROR = 0, 2, 1


def _load_claim(path: str) -> ClaimFile:
    file_path = Path(path)
    if not file_path.exists():
        candidate = FIXTURES / Path(path).name
        if candidate.exists():
            file_path = candidate
        else:
            raise SystemExit(f"No claim file at {path}")
    return ClaimFile.model_validate_json(file_path.read_text())


def _compile(source: ClaimFile, *, require_allowlist: bool):  # noqa: ANN201
    manifest = manifest_mod.build(source)
    allowed = {
        h.strip()
        for h in __import__("os").getenv("CLAIMCALL_ALLOWED_PHONE_HASHES", "").split(",")
        if h.strip()
    }
    report = safety.evaluate(
        manifest, allowed_phone_hashes=allowed, require_allowlist=require_allowlist
    )
    return manifest, report


def cmd_preview(args: argparse.Namespace) -> int:
    """Compile and safety-lint a plan. Never contacts anyone."""
    source = _load_claim(args.claim)
    manifest, report = _compile(source, require_allowlist=False)

    if args.json:
        print(
            json.dumps(
                {
                    "manifest": {
                        **manifest.model_dump(mode="json"),
                        "recipient_number_e164": mask_phone(manifest.recipient_number_e164),
                    },
                    "safety": report.model_dump(mode="json"),
                    "idempotency_key": dispatcher.idempotency_key_for(manifest),
                    "call_task": manifest_mod.render_call_task(manifest),
                },
                indent=2,
                default=str,
            )
        )
        return EXIT_OK if report.passed else EXIT_HELD

    print(manifest_mod.render_human(manifest))
    print()
    print(safety.render_report(report))
    print()
    print(f"Plan hash: {manifest.content_hash}")
    print(f"Idempotency key: {dispatcher.idempotency_key_for(manifest)}")
    if report.passed:
        print()
        print("To place this call for real, review the plan above, then run:")
        print(f"  claimcall run --claim {args.claim} --live --confirm {manifest.content_hash}")
    return EXIT_OK if report.passed else EXIT_HELD


def cmd_show_task(args: argparse.Namespace) -> int:
    """Print the exact text the phone agent will be given."""
    source = _load_claim(args.claim)
    manifest, _ = _compile(source, require_allowlist=False)
    print(manifest_mod.render_call_task(manifest))
    return EXIT_OK


def cmd_run(args: argparse.Namespace) -> int:
    """Dry run by default; --live places exactly one real call."""
    source = _load_claim(args.claim)
    manifest = manifest_mod.build(source)

    # Consent is checked before configuration, because "you have not confirmed
    # this plan" is the more useful thing to hear when both are wrong.
    if args.live and args.confirm != manifest.content_hash:
        print(
            "Refusing to place a live call: --confirm does not match this plan.\n"
            f"  plan hash:  {manifest.content_hash}\n"
            f"  you passed: {args.confirm or '(nothing)'}\n"
            "Run `claimcall preview` again and confirm the hash it prints.",
            file=sys.stderr,
        )
        return EXIT_HELD

    _, report = _compile(source, require_allowlist=args.live)
    if not report.passed:
        print(safety.render_report(report), file=sys.stderr)
        print("\nThe safety gate did not pass, so no call will be placed.", file=sys.stderr)
        return EXIT_HELD

    if args.live:
        print(f"LIVE: placing one call to {mask_phone(manifest.recipient_number_e164)}")
    else:
        print(f"DRY RUN: no call will be placed (scenario: {args.scenario})")

    try:
        outcome = dispatcher.run(
            manifest=manifest, safety=report, live=args.live, scenario=args.scenario
        )
    except dispatcher.LiveCallBlocked as exc:
        print(f"Live call blocked: {exc}", file=sys.stderr)
        return EXIT_HELD
    except dispatcher.DispatchRefused as exc:
        print(f"Dispatch refused ({exc.code}): {exc}", file=sys.stderr)
        return EXIT_HELD

    intent = outcome.intent
    print(f"  call intent:     {intent.id}")
    print(f"  state:           {intent.state.value}")
    print(f"  idempotency key: {intent.idempotency_key}")
    print(f"  provider call:   {intent.provider_call_id or '(none yet)'}")
    if outcome.deduplicated:
        print("  (deduplicated: an identical call was already reserved)")

    if not args.live and outcome.response is not None:
        record, verified = reconcile_mod.check_payload(
            manifest, outcome.response.raw, intent_id=intent.id
        )
        print()
        print(_render_result(record))
        print()
        print(reconcile_mod.render_outcome(verified))
        return EXIT_OK if verified.verdict.value == "verified" else EXIT_HELD

    print("\nThe call is in flight. Read its authoritative state with:")
    print(f"  claimcall reconcile --call-id {intent.provider_call_id} --claim {args.claim}")
    return EXIT_OK


def cmd_reconcile(args: argparse.Namespace) -> int:
    """Read authoritative provider state for a call. Never places one."""
    source = _load_claim(args.claim)
    manifest, _ = _compile(source, require_allowlist=False)

    provider = dispatcher.build_provider(live=args.live, scenario=args.scenario)
    if not args.live:
        # Materialise the fixture call so there is something to read back.
        from claimcall_core.providers import CallRequest
        from claimcall_core.result_schema import CALL_RESULT_SCHEMA

        provider.create_call(
            CallRequest(
                task=manifest_mod.render_call_task(manifest),
                recipient_e164=manifest.recipient_number_e164,
                idempotency_key=dispatcher.idempotency_key_for(manifest),
                result_schema=CALL_RESULT_SCHEMA,
            )
        )

    try:
        response = provider.get_call(args.call_id)
    except Exception as exc:  # noqa: BLE001
        print(f"Could not read call {args.call_id}: {exc}", file=sys.stderr)
        return EXIT_ERROR

    record, verified = reconcile_mod.check_payload(manifest, response.raw, intent_id="cli")
    if args.json:
        print(
            json.dumps(
                {
                    "status": response.status,
                    "result": record.result.model_dump(mode="json") if record.result else None,
                    "verification": verified.model_dump(mode="json"),
                },
                indent=2,
                default=str,
            )
        )
    else:
        print(_render_result(record))
        print()
        print(reconcile_mod.render_outcome(verified))
    return EXIT_OK if verified.verdict.value == "verified" else EXIT_HELD


def cmd_verify(args: argparse.Namespace) -> int:
    """Verify a saved provider result against the plan. Fully offline."""
    source = _load_claim(args.claim)
    manifest, _ = _compile(source, require_allowlist=False)

    path = Path(args.result)
    if not path.exists():
        candidate = FIXTURES / path.name
        if not candidate.exists():
            print(f"No result file at {args.result}", file=sys.stderr)
            return EXIT_ERROR
        path = candidate

    record, verified = reconcile_mod.check_payload(
        manifest, json.loads(path.read_text()), intent_id="cli"
    )
    print(_render_result(record))
    print()
    print(reconcile_mod.render_outcome(verified))
    return EXIT_OK if verified.verdict.value == "verified" else EXIT_HELD


def cmd_hash_number(args: argparse.Namespace) -> int:
    """Print the allowlist hash for a number, so the number itself stays out of env vars."""
    print(hash_phone(args.number))
    return EXIT_OK


def _render_result(record) -> str:  # noqa: ANN001
    if record.result is None:
        return "Call result: (none returned, or it failed schema validation)"
    result = record.result
    lines = [
        f"Call result ({record.terminal_status}):",
        f"  outcome:          {result.outcome.value}",
        f"  recipient check:  {result.recipient_verified.value}",
        f"  claim reference:  {result.claim_reference or '(none)'}",
        f"  coverage:         {result.coverage_status.value}",
    ]
    if result.documents_requested:
        lines.append(f"  documents asked:  {', '.join(result.documents_requested)}")
    for option in result.appointment_options:
        lines.append(
            f"  slot offered:     {option.start} to {option.end} "
            f"(explicitly offered: {option.explicitly_offered})"
        )
    if result.fee and result.fee.amount:
        lines.append(
            f"  fee discussed:    {result.fee.currency or ''} {result.fee.amount:g} "
            f"- NOT accepted"
        )
    for reason in result.uncertainty_reasons:
        lines.append(f"  uncertainty:      {reason}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="claimcall",
        description="Compile warranty evidence into one consented, safety-gated phone call.",
        epilog="Every command is a dry run unless you pass --live.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_claim(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--claim",
            default="eligible-claim.json",
            help="Path to a claim JSON file (bundled fixtures resolve by name).",
        )

    preview = subparsers.add_parser("preview", help="Compile and safety-lint a plan. No call.")
    add_claim(preview)
    preview.add_argument("--json", action="store_true", help="Machine-readable output.")
    preview.set_defaults(func=cmd_preview)

    show = subparsers.add_parser("show-task", help="Print the exact text given to the phone agent.")
    add_claim(show)
    show.set_defaults(func=cmd_show_task)

    run_cmd = subparsers.add_parser("run", help="Dry run, or place one real call with --live.")
    add_claim(run_cmd)
    run_cmd.add_argument(
        "--live",
        action="store_true",
        help="Place ONE real phone call. Consumes one CALL-E call. No rollback.",
    )
    run_cmd.add_argument(
        "--confirm", default="", help="Plan hash from `preview`. Required with --live."
    )
    run_cmd.add_argument(
        "--scenario",
        default="claim-registered",
        help="Dry-run fixture: claim-registered, needs-human-result, no-answer-result.",
    )
    run_cmd.set_defaults(func=cmd_run)

    rec = subparsers.add_parser("reconcile", help="Read authoritative provider state for a call.")
    add_claim(rec)
    rec.add_argument("--call-id", required=True, help="Provider call id.")
    rec.add_argument("--live", action="store_true", help="Read from CALL-E instead of a fixture.")
    rec.add_argument("--scenario", default="claim-registered")
    rec.add_argument("--json", action="store_true")
    rec.set_defaults(func=cmd_reconcile)

    ver = subparsers.add_parser("verify", help="Verify a saved result file. Fully offline.")
    add_claim(ver)
    ver.add_argument("--result", required=True, help="Path to a provider result JSON file.")
    ver.set_defaults(func=cmd_verify)

    hash_cmd = subparsers.add_parser(
        "hash-number", help="Print the allowlist hash for an E.164 number."
    )
    hash_cmd.add_argument("number", help="E.164 number, e.g. +15005550006")
    hash_cmd.set_defaults(func=cmd_hash_number)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
