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
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Sequence

from clients import (
    DEFAULT_BASE_URL,
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    REST_BASE_URL_ENV_VAR,
    AuthUnavailableError,
    ConfigurationError,
    GoalRunStatusClient,
    McpStatusClient,
    ReplayClient,
    RestStatusClient,
    StatusClient,
    UpstreamRequestError,
    resolve_base_url,
)
from mapping import MappingError, OutcomeMap, default_map_path
from poller import DEFAULT_POLICY, PollingPolicy, poll
from reconciler import reconcile
from record import mask_phone, mask_reference

EXIT_OK = 0
EXIT_UNRESOLVED = 2
EXIT_ERROR = 1

#: Base instant for a replayed record when the fixture does not name one.
REPLAY_EPOCH = "2026-01-01T00:00:00+00:00"


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
        if not args.mcp_server_url:
            raise ConfigurationError(
                "Reading the mcp.get_call_run surface needs a server URL. Pass --mcp-server-url."
            )
        return McpStatusClient(
            server_url=args.mcp_server_url,
            token_cache_path=Path(args.token_cache) if args.token_cache else None,
            timeout_seconds=args.request_timeout,
        )
    base_url = resolve_base_url(args.base_url)
    if args.surface == "rest.goal_runs":
        return GoalRunStatusClient(
            base_url=base_url,
            timeout_seconds=args.request_timeout,
            goal_id=args.goal_id or "",
        )
    return RestStatusClient(base_url=base_url, timeout_seconds=args.request_timeout)


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
    except UpstreamRequestError as exc:
        print(f"Upstream refused the request: {exc}", file=sys.stderr)
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
    policy = _policy_from_args(args)
    result = poll(
        args.call_ref,
        client,
        outcome_map,
        policy,
        clock=_StepClock(),
        sleep=lambda _seconds: None,
        timestamp=_StepTimestamp(client.started_at or REPLAY_EPOCH, policy),
    )
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


class _StepClock:
    """A monotonic clock that advances one second per read. Replays never sleep."""

    def __init__(self) -> None:
        self._now = 0.0

    def __call__(self) -> float:
        self._now += 1.0
        return self._now


class _StepTimestamp:
    """Deterministic observation timestamps for a replay.

    A replay never sleeps, so reading the wall clock would report a fixture
    modelling a five-day stuck call as having elapsed a few microseconds. This
    advances by the policy's un-jittered backoff instead, so `timing` in a
    replayed record reads the way the same sequence would have read live.
    """

    def __init__(self, base: str, policy: PollingPolicy) -> None:
        self._now = datetime.fromisoformat(base.replace("Z", "+00:00"))
        self._policy = policy
        self._delay = 0.0

    def __call__(self) -> str:
        self._now += timedelta(seconds=self._delay)
        self._delay = (
            self._policy.initial_backoff_seconds
            if self._delay == 0.0
            else min(self._delay * 2, self._policy.max_backoff_seconds)
        )
        return self._now.isoformat()


def _load_record(path: Path) -> dict[str, Any]:
    """Read an outcome record, refusing anything that is not one.

    `explain` is the command people point at a file by hand, so a wrong path is
    the most likely mistake it will ever see. It should say so rather than
    raising from inside a dict lookup.
    """
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigurationError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ConfigurationError(f"{path} is not an outcome record: expected a JSON object")
    missing = [key for key in ("call_ref", "outcome", "mapping") if key not in loaded]
    if missing:
        raise ConfigurationError(
            f"{path} is not an outcome record; it has no {', '.join(missing)}. "
            "Produce one with `reconcile` or `replay` and its --output flag."
        )
    return loaded


def cmd_explain(args: argparse.Namespace) -> int:
    record_dict = _load_record(Path(args.record))
    mapping_trace = record_dict.get("mapping", {})
    timing = record_dict.get("timing", {})
    evidence = record_dict.get("evidence", {})

    print(f"call_ref        {mask_reference(record_dict.get('call_ref'))}")
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
    judgment = record_dict.get("upstream_judgment") or {}
    if judgment:
        print("upstream judgment")
        if "task_completed" in judgment:
            print(f"  task_completed  {judgment['task_completed']}")
        confidence = judgment.get("completion_confidence") or {}
        if confidence:
            print(f"  confidence      {confidence.get('label')} ({confidence.get('score')})")
        # `summary` and `evidence` are upstream's prose about what was said on
        # the call. They stay in the JSON record and out of this view, which is
        # documented as safe to share.
        for field in ("summary", "evidence"):
            if judgment.get(field):
                print(f"  {field:<15} <in the record; not shown here — call content>")
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
    reconcile_cmd.add_argument(
        "--call-ref",
        required=True,
        help="Upstream call identifier. With --surface rest.goal_runs this is the GoalRun.id "
        "returned by create, not the nested telephone run_id.",
    )
    reconcile_cmd.add_argument(
        "--surface",
        default="rest.calls",
        choices=["rest.calls", "rest.goal_runs", "mcp.get_call_run"],
        help="Which status surface to poll. Default: rest.calls.",
    )
    reconcile_cmd.add_argument("--dry-run", action="store_true", help="Replay a fixture; makes no network request.")
    reconcile_cmd.add_argument("--fixture", help="Fixture to replay with --dry-run.")
    reconcile_cmd.add_argument(
        "--base-url",
        help=f"REST base URL. Default: {DEFAULT_BASE_URL} (or {REST_BASE_URL_ENV_VAR}). The API key "
        "is only ever sent to that host or to loopback, so a local fake works and a mistyped host "
        "is refused before the key is read.",
    )
    reconcile_cmd.add_argument("--goal-id", help="Goal id. Required when --surface rest.goal_runs.")
    reconcile_cmd.add_argument("--mcp-server-url", help="MCP server URL when --surface mcp.get_call_run.")
    reconcile_cmd.add_argument(
        "--token-cache",
        help="Path to the CALL-E CLI token cache. Defaults to the path `calle auth login` writes.",
    )
    reconcile_cmd.add_argument(
        "--request-timeout",
        type=float,
        default=DEFAULT_REQUEST_TIMEOUT_SECONDS,
        help=f"Per-request timeout. Default: {DEFAULT_REQUEST_TIMEOUT_SECONDS}.",
    )
    reconcile_cmd.add_argument("--recipient", help="Recipient E.164, used only to render a masked value.")
    add_budget_args(reconcile_cmd)
    reconcile_cmd.set_defaults(func=cmd_reconcile)

    replay_cmd = sub.add_parser("replay", help="Replay a recorded fixture. Makes no network request.")
    replay_cmd.add_argument("--fixture", required=True, help="Fixture JSON to replay.")
    replay_cmd.add_argument("--call-ref", default="call_replayed_fixture", help="Call reference to record.")
    replay_cmd.add_argument(
        "--recipient",
        help="Recipient E.164, used only to render a masked value when the fixture names none.",
    )
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
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except FileNotFoundError as exc:
        print(f"File not found: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except json.JSONDecodeError as exc:
        print(f"Not valid JSON: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
