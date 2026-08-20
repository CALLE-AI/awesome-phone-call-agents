"""Command line interface for the outcome reconciler.

    python cli.py reconcile --call-ref <ref>
    python cli.py reconcile --call-ref <ref> --dry-run --fixture fixtures/happy.json
    python cli.py replay --fixture fixtures/stuck.json
    python cli.py explain --record out.json

This app places no calls. It only reads the status of a call reference that
already exists, and it never persists credentials.

Phone numbers are masked in every human-readable line this CLI prints. The JSON
record preserves upstream payloads verbatim, which may include an unmasked
number if upstream returned one — see the README before sharing a record.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from clients import (
    AuthUnavailableError,
    McpStatusClient,
    ReplayClient,
    RestStatusClient,
    StatusClient,
)
from mapping import MappingError, OutcomeMap, default_map_path
from poller import DEFAULT_POLICY, PollingPolicy, poll
from reconciler import reconcile
from record import mask_phone

EXIT_OK = 0
EXIT_UNRESOLVED = 2
EXIT_ERROR = 1


def _policy_from_args(args: argparse.Namespace) -> PollingPolicy:
    return PollingPolicy(
        max_wall_clock_seconds=args.max_seconds,
        max_observations=args.max_observations,
        initial_backoff_seconds=args.initial_backoff,
        max_backoff_seconds=args.max_backoff,
        jitter_ratio=DEFAULT_POLICY.jitter_ratio,
    )


def _build_client(args: argparse.Namespace) -> StatusClient:
    if args.dry_run or args.fixture:
        if not args.fixture:
            raise SystemExit("--dry-run requires --fixture; it never opens a network connection")
        return ReplayClient.from_fixture(Path(args.fixture))
    if args.surface == "mcp.get_call_run":
        return McpStatusClient(
            server_url=args.mcp_server_url,
            token_cache_path=Path(args.token_cache) if args.token_cache else None,
        )
    client = RestStatusClient()
    if args.base_url:
        client.base_url = args.base_url
    return client


def _emit(record_dict: dict[str, Any], output: Path | None) -> None:
    text = json.dumps(record_dict, indent=2, sort_keys=False)
    if output:
        output.write_text(text + "\n", encoding="utf-8")
        print(f"Wrote outcome record to {output}")
    else:
        print(text)


def _summary_line(record_dict: dict[str, Any]) -> str:
    outcome = record_dict["outcome"]
    reason = record_dict.get("reason")
    masked = record_dict.get("recipient", {}).get("phone_e164_masked") or "unknown recipient"
    tail = f" ({reason})" if reason else ""
    return f"{record_dict['call_ref']} -> {outcome}{tail} for {masked}"


def cmd_reconcile(args: argparse.Namespace) -> int:
    outcome_map = OutcomeMap.load(Path(args.map) if args.map else None)
    client = _build_client(args)
    try:
        result = poll(args.call_ref, client, outcome_map, _policy_from_args(args))
    except AuthUnavailableError as exc:
        print(f"Authentication unavailable: {exc}", file=sys.stderr)
        return EXIT_ERROR

    record = reconcile(
        args.call_ref,
        result.observations,
        outcome_map,
        recipient_phone=result.recipient_phone or args.recipient,
        exhausted=result.exhausted,
        exhaustion_reason=result.exhaustion_reason,
    )
    payload = record.to_dict()
    _emit(payload, Path(args.output) if args.output else None)
    print(_summary_line(payload), file=sys.stderr)
    return EXIT_UNRESOLVED if payload["outcome"] == "unresolved" else EXIT_OK


def cmd_replay(args: argparse.Namespace) -> int:
    outcome_map = OutcomeMap.load(Path(args.map) if args.map else None)
    client = ReplayClient.from_fixture(Path(args.fixture))
    result = poll(
        args.call_ref,
        client,
        outcome_map,
        _policy_from_args(args),
        clock=_StepClock(),
        sleep=lambda _seconds: None,
    )
    record = reconcile(
        args.call_ref,
        result.observations,
        outcome_map,
        recipient_phone=result.recipient_phone,
        exhausted=result.exhausted,
        exhaustion_reason=result.exhaustion_reason,
    )
    payload = record.to_dict()
    _emit(payload, Path(args.output) if args.output else None)
    print(_summary_line(payload), file=sys.stderr)
    return EXIT_UNRESOLVED if payload["outcome"] == "unresolved" else EXIT_OK


class _StepClock:
    """A monotonic clock that advances one second per read. Replays never sleep."""

    def __init__(self) -> None:
        self._now = 0.0

    def __call__(self) -> float:
        self._now += 1.0
        return self._now


def cmd_explain(args: argparse.Namespace) -> int:
    record_dict = json.loads(Path(args.record).read_text(encoding="utf-8"))
    mapping_trace = record_dict.get("mapping", {})
    timing = record_dict.get("timing", {})
    evidence = record_dict.get("evidence", {})

    print(f"call_ref        {record_dict.get('call_ref')}")
    print(f"outcome         {record_dict.get('outcome')}")
    print(f"reason          {record_dict.get('reason') or '-'}")
    print(f"recipient       {record_dict.get('recipient', {}).get('phone_e164_masked') or '-'}")
    print()
    print("mapping")
    print(f"  matched       {mapping_trace.get('matched')}")
    print(f"  entry_id      {mapping_trace.get('entry_id') or '-'}")
    print(f"  surface       {mapping_trace.get('surface') or '-'}")
    print(f"  map_version   {mapping_trace.get('map_version')}")
    print()
    print("timing")
    print(f"  observations  {timing.get('observation_count')}")
    print(f"  elapsed       {timing.get('elapsed_seconds')}s")
    print(f"  first / last  {timing.get('first_observed_at')} .. {timing.get('last_observed_at')}")
    print()
    print("observed states")
    for state in evidence.get("observed_states", []):
        print(f"  - {state}")
    print()
    print("decision trail")
    for step in evidence.get("decision", []):
        print(f"  - {step}")
    if evidence.get("notes"):
        print()
        print("notes")
        for note in evidence["notes"]:
            print(f"  - {note}")
    return EXIT_OK


def cmd_show_map(args: argparse.Namespace) -> int:
    outcome_map = OutcomeMap.load(Path(args.map) if args.map else None)
    print(f"map_version {outcome_map.map_version}  ({outcome_map.path})")
    print(f"contract    {outcome_map.upstream_contract_ref} v{outcome_map.upstream_contract_version}")
    print()
    for name, surface in outcome_map.surfaces.items():
        flag = "documented" if surface.documented else "UNDOCUMENTED"
        print(f"{name}  [{flag}]  status field: {surface.status_field}")
    print()
    print("documented entries")
    for entry in outcome_map.entries:
        print(f"  {entry.id:34s} {dict(entry.match)} -> {entry.outcome}")
    print()
    print("published but unmappable")
    for item in outcome_map.unmappable:
        print(f"  {item.id:34s} {dict(item.match)} -> unresolved ({item.reason})")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="outcome-reconciler",
        description="Resolve a CALL-E call reference to exactly one terminal outcome. Places no calls.",
    )
    parser.add_argument("--map", help=f"Path to the mapping table. Default: {default_map_path()}")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_budget_args(target: argparse.ArgumentParser) -> None:
        target.add_argument(
            "--max-seconds",
            type=float,
            default=DEFAULT_POLICY.max_wall_clock_seconds,
            help=f"Wall-clock budget. Default: {DEFAULT_POLICY.max_wall_clock_seconds}.",
        )
        target.add_argument(
            "--max-observations",
            type=int,
            default=DEFAULT_POLICY.max_observations,
            help=f"Observation budget. Default: {DEFAULT_POLICY.max_observations}.",
        )
        target.add_argument(
            "--initial-backoff",
            type=float,
            default=DEFAULT_POLICY.initial_backoff_seconds,
            help=f"First delay between polls. Default: {DEFAULT_POLICY.initial_backoff_seconds}.",
        )
        target.add_argument(
            "--max-backoff",
            type=float,
            default=DEFAULT_POLICY.max_backoff_seconds,
            help=f"Delay ceiling. Default: {DEFAULT_POLICY.max_backoff_seconds}.",
        )
        target.add_argument("--output", help="Write the outcome record here instead of stdout.")

    reconcile_cmd = sub.add_parser("reconcile", help="Poll a call reference and emit one outcome record.")
    reconcile_cmd.add_argument("--call-ref", required=True, help="Upstream call identifier.")
    reconcile_cmd.add_argument(
        "--surface",
        default="rest.calls",
        choices=["rest.calls", "mcp.get_call_run"],
        help="Which status surface to poll. Default: rest.calls.",
    )
    reconcile_cmd.add_argument("--dry-run", action="store_true", help="Replay a fixture; makes no network request.")
    reconcile_cmd.add_argument("--fixture", help="Fixture to replay with --dry-run.")
    reconcile_cmd.add_argument("--base-url", help="Override the REST base URL.")
    reconcile_cmd.add_argument("--mcp-server-url", help="MCP server URL when --surface mcp.get_call_run.")
    reconcile_cmd.add_argument("--token-cache", help="Path to the CALL-E CLI token cache.")
    reconcile_cmd.add_argument("--recipient", help="Recipient E.164, used only to render a masked value.")
    add_budget_args(reconcile_cmd)
    reconcile_cmd.set_defaults(func=cmd_reconcile)

    replay_cmd = sub.add_parser("replay", help="Replay a recorded fixture. Makes no network request.")
    replay_cmd.add_argument("--fixture", required=True, help="Fixture JSON to replay.")
    replay_cmd.add_argument("--call-ref", default="call_replayed_fixture", help="Call reference to record.")
    add_budget_args(replay_cmd)
    replay_cmd.set_defaults(func=cmd_replay)

    explain_cmd = sub.add_parser("explain", help="Explain why a record has the outcome it has.")
    explain_cmd.add_argument("--record", required=True, help="Outcome record JSON to explain.")
    explain_cmd.set_defaults(func=cmd_explain)

    show_map_cmd = sub.add_parser("show-map", help="Print the mapping table as loaded.")
    show_map_cmd.set_defaults(func=cmd_show_map)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except MappingError as exc:
        print(f"Mapping table error: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except FileNotFoundError as exc:
        print(f"File not found: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
