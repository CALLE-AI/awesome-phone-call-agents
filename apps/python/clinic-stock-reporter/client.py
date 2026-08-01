"""CALL-E Developer API client for the clinic stock-reporter.

Reads a clinic roster (JSONL), creates one CALL-E call task per clinic via the
official `calle-ai` Python SDK, waits for the terminal structured result,
classifies it into red/amber/green, writes the raw result to JSONL, and ingests
the structured row into the SQLite store.

Auth uses a project API key (CALLE_API_KEY), provisioned at
https://dashboard.heycall-e.com/account/api-keys. No browser login or Node CLI
is required.

Architecture: the host scheduler (scheduler.py) handles recurrence. This
client performs exactly one call task per clinic per invocation. See README.md.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from calle import CalleAPIError, CalleClient
from rich.console import Console

import questionnaire
from ingest import Store

DEFAULT_BASE_URL = "https://api.heycall-e.com"
DEFAULT_RESULTS_DIR = "results"
DEFAULT_OUTPUT_NAME = "clinic_call_results.jsonl"
DEFAULT_DB_NAME = "clinic_reports.db"
TERMINAL_STATUSES = {"completed", "failed", "canceled"}


@dataclass(frozen=True)
class Config:
    input_path: Path
    results_dir: Path
    output_path: Path
    db_path: Path
    mode: str  # dry_run | execute
    api_key: str
    base_url: str
    region: str
    locale: str
    poll_interval_seconds: float
    poll_timeout_seconds: float


def parse_positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("expected a positive number")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Call clinics via CALL-E and ingest weekly HMIS stock reports.")
    parser.add_argument("--input", required=True, type=Path, help="Path to the clinic roster JSONL file.")
    parser.add_argument("--results-dir", type=Path, default=Path(DEFAULT_RESULTS_DIR))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--db", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Preview each call payload without placing a call. This is the default.")
    mode.add_argument("--execute", action="store_true", help="Create a real CALL-E call task per clinic and wait for the result.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--region", default="US", help="Default recipient region if the roster omits one. Default US.")
    parser.add_argument("--locale", default="en-US", help="Default recipient locale if the roster omits one. Default en-US.")
    parser.add_argument("--poll-interval-seconds", type=parse_positive_float, default=2.0)
    parser.add_argument("--poll-timeout-seconds", type=parse_positive_float, default=600.0)
    return parser


def read_config(argv: list[str] | None = None) -> Config:
    args = build_parser().parse_args(argv)
    mode = "execute" if args.execute else "dry_run"
    results_dir = args.results_dir.expanduser()
    api_key = os.environ.get("CALLE_API_KEY", "")
    return Config(
        input_path=args.input.expanduser(),
        results_dir=results_dir,
        output_path=args.output.expanduser() if args.output else results_dir / DEFAULT_OUTPUT_NAME,
        db_path=args.db.expanduser() if args.db else results_dir / DEFAULT_DB_NAME,
        mode=mode,
        api_key=api_key,
        base_url=args.base_url,
        region=args.region,
        locale=args.locale,
        poll_interval_seconds=args.poll_interval_seconds,
        poll_timeout_seconds=args.poll_timeout_seconds,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_jsonl(path: Path) -> list[tuple[int, dict[str, Any]]]:
    items: list[tuple[int, dict[str, Any]]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            parsed = json.loads(stripped)
            if not isinstance(parsed, dict):
                raise ValueError(f"Line {line_number} must be a JSON object")
            items.append((line_number, parsed))
    return items


def normalize_roster_item(line_number: int, raw: dict[str, Any], default_region: str, default_locale: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Split a roster line into a call payload, metadata, and clinic identity.

    Roster line shape:
      {
        "clinic_id": "hcii-kapeeka",
        "clinic_name": "Kapeeka HC II",
        "nurse_name": "Jane",
        "to_phones": ["+256700000001"],
        "region": "UG", "locale": "en-UG",
        "metadata": {"district": "Nakaseke"}
      }
    """
    clinic_meta = {key: raw[key] for key in ("clinic_id", "clinic_name", "nurse_name") if key in raw and raw[key] is not None}
    if not clinic_meta.get("clinic_id"):
        raise ValueError(f"Line {line_number} is missing clinic_id")
    phones = raw.get("to_phones")
    if not isinstance(phones, list) or not phones:
        raise ValueError(f"Line {line_number} is missing to_phones")
    region = raw.get("region", default_region)
    locale = raw.get("locale", default_locale)
    task = questionnaire.build_task(
        clinic_id=clinic_meta["clinic_id"],
        clinic_name=str(clinic_meta.get("clinic_name") or clinic_meta["clinic_id"]),
        nurse_name=clinic_meta.get("nurse_name"),
    )
    metadata = dict(raw.get("metadata") or {})
    metadata.update(clinic_meta)
    payload = {
        "task": task,
        "recipient": {"phones": phones, "region": region, "locale": locale},
        "result_schema": questionnaire.RESULT_SCHEMA,
        "metadata": metadata,
        "idempotency_key": f"clinic-stock-reporter-{clinic_meta['clinic_id']}-{int(time.time())}",
    }
    return payload, metadata, clinic_meta


def _structured_result(call: dict[str, Any]) -> dict[str, Any] | None:
    sr = call.get("structured_result")
    return sr if isinstance(sr, dict) else None


def _recipient_result(call: dict[str, Any]) -> dict[str, Any] | None:
    recipients = call.get("recipients")
    if isinstance(recipients, list) and recipients:
        first = recipients[0]
        if isinstance(first, dict):
            sr = first.get("structured_result")
            if isinstance(sr, dict):
                return sr
    return None


def process_batch(config: Config, items: list[tuple[int, dict[str, Any]]], console: Console, calle_client: CalleClient | None = None) -> int:
    if not config.api_key:
        console.print("[red]CALLE_API_KEY is not set.[/] Get a key at https://dashboard.heycall-e.com/account/api-keys")
        return 2
    store = Store(config.db_path)
    config.output_path.parent.mkdir(parents=True, exist_ok=True)
    own_client = calle_client is None
    client = calle_client or CalleClient(api_key=config.api_key, base_url=config.base_url)
    failures = 0
    with config.output_path.open("w", encoding="utf-8") as output:
        for line_number, raw in items:
            try:
                payload, metadata, clinic_meta = normalize_roster_item(line_number, raw, config.region, config.locale)
            except ValueError as error:
                console.print(f"[red]Line {line_number} invalid:[/] {error}")
                failures += 1
                continue
            record: dict[str, Any] = {
                "line_number": line_number,
                "clinic_id": clinic_meta["clinic_id"],
                "mode": config.mode,
                "ok": False,
                "started_at": None,
                "ended_at": None,
                "call_id": None,
                "status": None,
                "structured_result": None,
                "report": None,
            }
            started_monotonic = time.perf_counter()
            try:
                if config.mode == "dry_run":
                    record["payload_preview"] = payload
                    record["ok"] = True
                    console.print(f"[green]dry_run ok[/] line {line_number} {clinic_meta['clinic_id']} region={payload['recipient']['region']}")
                else:
                    record["started_at"] = utc_now_iso()
                    call = client.calls.create(
                        task=payload["task"],
                        recipient=payload["recipient"],
                        result_schema=payload["result_schema"],
                        metadata=payload["metadata"],
                        idempotency_key=payload["idempotency_key"],
                    )
                    call_id = str(call.get("id") or "")
                    record["call_id"] = call_id
                    record["status"] = call.get("status")
                    completed = client.calls.wait_for_result(
                        call_id,
                        interval_seconds=config.poll_interval_seconds,
                        timeout_seconds=config.poll_timeout_seconds,
                    )
                    record["ended_at"] = utc_now_iso()
                    record["duration_seconds"] = time.perf_counter() - started_monotonic
                    record["status"] = completed.get("status")
                    sr = _structured_result(completed) or _recipient_result(completed)
                    record["structured_result"] = sr
                    report = questionnaire.classify(sr, clinic_id=clinic_meta["clinic_id"])
                    record["report"] = {
                        "fields": report.fields,
                        "missing": report.missing,
                        "red_flags": report.red_flags,
                        "severity": report.severity,
                    }
                    store.ingest(clinic_meta, report, {"final_status": record["status"], "run_id": call_id, "duration_seconds": record.get("duration_seconds"), "post_summary": completed.get("summary")})
                    if completed.get("status") == "completed":
                        record["ok"] = True
                        console.print(f"[green]ok[/] {clinic_meta['clinic_id']} {report.severity} flags={report.red_flags}")
                    else:
                        console.print(f"[yellow]non-complete[/] {clinic_meta['clinic_id']} status={record['status']}")
            except CalleAPIError as error:
                record["error"] = {"code": error.code, "message": str(error), "status_code": error.status_code}
                console.print(f"[red]api error[/] {clinic_meta['clinic_id']}: {error.code}: {error}")
                failures += 1
            except Exception as error:
                record["error"] = {"type": type(error).__name__, "message": str(error)}
                console.print(f"[red]failed[/] line {line_number} {clinic_meta['clinic_id']}: {type(error).__name__}: {error}")
                failures += 1
            output.write(json.dumps(record, default=str) + "\n")
            output.flush()
    if own_client:
        client.close()
    console.print(f"[bold]Done.[/] {config.output_path}  db={config.db_path}  failures={failures}")
    return 0 if failures == 0 else 1


def run(argv: list[str] | None = None) -> int:
    console = Console()
    config = read_config(argv)
    raw_items = load_jsonl(config.input_path)
    if not raw_items:
        raise ValueError(f"No JSONL records found in {config.input_path}")
    console.print(f"[green]Loaded[/] {len(raw_items)} clinic record(s) from {config.input_path}")
    return process_batch(config, raw_items, console)


def main() -> int:
    try:
        return run()
    except Exception as error:
        Console(stderr=True).print(f"[red]Error:[/] {type(error).__name__}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
