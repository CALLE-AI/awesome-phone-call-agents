"""CALL-E batch client for the clinic stock-reporter.

Reads a clinic roster (JSONL), calls CALL-E for each clinic via the MCP tools
`plan_call` -> `run_call` -> `get_call_run`, captures the `post_summary`, parses
the REPORT line into structured fields, writes the raw result to JSONL, and
ingests the structured row into the SQLite store.

Auth reuses the local `calle` CLI login state (token cache) exactly like
apps/python/batch-runner. Default mode is dry-run (plan_call only); execute
mode is opt-in.

Architecture: the host scheduler (scheduler.py) handles recurrence. This client
performs exactly one call per clinic per invocation. See README.md.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from rich.console import Console

import questionnaire
from ingest import Store

DEFAULT_BASE_URL = "https://seleven-mcp-sg.airudder.com"
DEFAULT_CHANNEL = "openagent_oauth"
DEFAULT_CACHE_ROOT = "~/.calle-mcp/cli"
DEFAULT_RESULTS_DIR = "results"
DEFAULT_OUTPUT_NAME = "clinic_call_results.jsonl"
DEFAULT_DB_NAME = "clinic_reports.db"
DEFAULT_CLI_PACKAGE = "@call-e/cli"
INTEGRATION_HEADER = "apps/python/clinic-stock-reporter/0.0.0"
TERMINAL_STATUSES = {
    "BUSY", "CANCELED", "CANCELLED", "COMPLETED", "DECLINED",
    "EXPIRED", "FAILED", "NO_ANSWER", "VOICEMAIL",
}
PLAN_CALL_FIELDS = {"to_phones", "region", "language", "goal", "user_input"}
SECRET_KEYS = {"access_token", "refresh_token", "confirm_token", "session_secret"}
MASKED_PHONE_PREFIX = "+256700"  # fictional Uganda test range


@dataclass(frozen=True)
class Config:
    input_path: Path
    results_dir: Path
    output_path: Path
    db_path: Path
    mode: str
    base_url: str
    channel: str
    server_url: str
    cache_root: str
    calle_command: list[str]
    cli_package: str
    auto_install_cli: bool
    login_wait: bool
    timeout_seconds: float
    poll_interval_seconds: float
    poll_timeout_seconds: float


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def resolve_server_url(base_url: str, channel: str, server_url: str | None) -> str:
    if server_url:
        return server_url
    return f"{normalize_base_url(base_url)}/mcp/{channel.strip().lower() or DEFAULT_CHANNEL}"


def expand_home(value: str) -> str:
    return str(Path(value).expanduser())


def parse_positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("expected a positive number")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Call clinics via CALL-E and parse weekly HMIS stock reports.")
    parser.add_argument("--input", required=True, type=Path, help="Path to the clinic roster JSONL file.")
    parser.add_argument("--results-dir", type=Path, default=Path(DEFAULT_RESULTS_DIR))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--db", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Call plan_call only. This is the default.")
    mode.add_argument("--execute", action="store_true", help="Call plan_call and then run_call for ready plans.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--channel", default=DEFAULT_CHANNEL)
    parser.add_argument("--server-url")
    parser.add_argument("--cache-root", default=DEFAULT_CACHE_ROOT)
    parser.add_argument("--calle-command", default="calle")
    parser.add_argument("--cli-package", default=DEFAULT_CLI_PACKAGE)
    parser.add_argument("--no-auto-install-cli", action="store_true")
    parser.add_argument("--no-login-wait", action="store_true")
    parser.add_argument("--timeout-seconds", type=parse_positive_float, default=30.0)
    parser.add_argument("--poll-interval-seconds", type=parse_positive_float, default=10.0)
    parser.add_argument("--poll-timeout-seconds", type=parse_positive_float, default=900.0)
    return parser


def read_config(argv: list[str] | None = None) -> Config:
    args = build_parser().parse_args(argv)
    mode = "execute" if args.execute else "dry_run"
    results_dir = args.results_dir.expanduser()
    return Config(
        input_path=args.input.expanduser(),
        results_dir=results_dir,
        output_path=args.output.expanduser() if args.output else results_dir / DEFAULT_OUTPUT_NAME,
        db_path=args.db.expanduser() if args.db else results_dir / DEFAULT_DB_NAME,
        mode=mode,
        base_url=args.base_url,
        channel=args.channel,
        server_url=resolve_server_url(args.base_url, args.channel, args.server_url),
        cache_root=args.cache_root,
        calle_command=shlex.split(args.calle_command),
        cli_package=args.cli_package,
        auto_install_cli=not args.no_auto_install_cli,
        login_wait=not args.no_login_wait,
        timeout_seconds=args.timeout_seconds,
        poll_interval_seconds=args.poll_interval_seconds,
        poll_timeout_seconds=args.poll_timeout_seconds,
    )


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, text=True, capture_output=True)


def executable_exists(command: list[str]) -> bool:
    if not command:
        return False
    executable = command[0]
    if Path(executable).expanduser().exists():
        return True
    return shutil.which(executable) is not None


class CliUnavailableError(Exception):
    pass


class AuthRequiredError(Exception):
    pass


def install_calle_cli(config: Config, console: Console) -> None:
    npm_path = shutil.which("npm")
    if not npm_path:
        raise CliUnavailableError(
            f"`{config.calle_command[0]}` is not installed and `npm` was not found. "
            f"Run `npm install -g {config.cli_package}` manually."
        )
    console.print(f"[yellow]Installing[/] {config.cli_package} ...")
    completed = run_command([npm_path, "install", "-g", config.cli_package])
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise CliUnavailableError(f"CLI install failed: {detail}")
    if not executable_exists(config.calle_command):
        raise CliUnavailableError(f"Installed {config.cli_package} but `calle` is not on PATH.")


def ensure_calle_cli(config: Config, console: Console) -> None:
    if executable_exists(config.calle_command):
        return
    if not config.auto_install_cli:
        raise CliUnavailableError(f"`{config.calle_command[0]}` is not installed.")
    install_calle_cli(config, console)


def auth_common_args(config: Config) -> list[str]:
    args = ["--base-url", config.base_url, "--channel", config.channel, "--server-url", config.server_url]
    if config.cache_root:
        args.extend(["--cache-root", expand_home(config.cache_root)])
    return args


def run_calle_json(config: Config, args: list[str]) -> dict[str, Any]:
    command = [*config.calle_command, *args, *auth_common_args(config), "--json"]
    completed = run_command(command)
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"exit code {completed.returncode}"
        raise RuntimeError(f"calle command failed: {detail}")
    parsed = json.loads(completed.stdout)
    if not isinstance(parsed, dict):
        raise RuntimeError("calle command did not return a JSON object")
    return parsed


def server_hash(server_url: str) -> str:
    return hashlib.md5(server_url.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_iso_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def token_cache_path_from_status(config: Config, status: dict[str, Any]) -> Path:
    cache_path = status.get("cache_path")
    if isinstance(cache_path, str) and cache_path:
        return Path(cache_path).expanduser()
    server_url = status.get("server_url") if isinstance(status.get("server_url"), str) else config.server_url
    return Path(expand_home(config.cache_root)) / server_hash(server_url) / "token.json"


def token_document_usable(document: dict[str, Any] | None, min_ttl_seconds: float) -> bool:
    if not document:
        return False
    token = document.get("token")
    if not isinstance(token, dict) or not isinstance(token.get("access_token"), str) or not token["access_token"]:
        return False
    expires_at = parse_iso_date(document.get("expires_at"))
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return (expires_at - datetime.now(timezone.utc)).total_seconds() > min_ttl_seconds


def access_token(document: dict[str, Any]) -> str:
    token = document.get("token")
    if not isinstance(token, dict) or not isinstance(token.get("access_token"), str):
        raise RuntimeError("Token cache does not contain an access token")
    return token["access_token"]


def wait_for_cli_login(config: Config, console: Console) -> dict[str, Any]:
    login_command = [*config.calle_command, "auth", "login", *auth_common_args(config)]
    while True:
        if not config.login_wait:
            raise AuthRequiredError("CALL-E CLI is not logged in. Run `calle auth login` first.")
        console.print(f"Run in another terminal: {' '.join(login_command)}\nPress Enter when done.")
        try:
            input()
        except EOFError as error:
            raise AuthRequiredError("Login required but stdin is not interactive.") from error
        status = run_calle_json(config, ["auth", "status"])
        if status.get("usable"):
            return status
        console.print("[yellow]Token still not usable. Waiting again.[/]")


def read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def ensure_access_token(config: Config, console: Console) -> str:
    ensure_calle_cli(config, console)
    status = run_calle_json(config, ["auth", "status"])
    if not status.get("usable"):
        status = wait_for_cli_login(config, console)
    cache_path = token_cache_path_from_status(config, status)
    token_document = read_json_file(cache_path)
    if not token_document_usable(token_document, 300.0):
        raise AuthRequiredError(f"CLI token cache missing, expired, or malformed: {cache_path}")
    console.print(f"[green]Auth precheck passed:[/] using token cache at {cache_path}")
    return access_token(token_document)


def redacted(value: Any) -> Any:
    if isinstance(value, list):
        return [redacted(item) for item in value]
    if isinstance(value, dict):
        return {key: ("[REDACTED]" if key in SECRET_KEYS else redacted(item)) for key, item in value.items()}
    return value


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        try:
            return jsonable(value.model_dump(mode="json", by_alias=True))
        except Exception:
            return str(value)
    return str(value)


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


def first_string(payload: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def candidate_payloads(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    payloads = [value]
    for key in ("structured_content", "structuredContent", "data", "result", "status_result", "call", "run"):
        nested = value.get(key)
        if isinstance(nested, dict):
            payloads.extend(candidate_payloads(nested))
    return payloads


def extract_post_summary(value: Any) -> str | None:
    for payload in candidate_payloads(value):
        summary = first_string(payload, ("post_summary", "postsummary", "summary", "message"))
        if summary:
            return summary
    return None


def extract_status(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("status", "call_status", "state"):
            status = value.get(key)
            if isinstance(status, str) and status:
                return status.upper()
        for key in ("status_result", "result", "call", "run"):
            status = extract_status(value.get(key))
            if status:
                return status
        for item in value.values():
            status = extract_status(item)
            if status:
                return status
    if isinstance(value, list):
        for item in value:
            status = extract_status(item)
            if status:
                return status
    return None


def structured_content(result: Any, dumped: dict[str, Any]) -> dict[str, Any]:
    value = getattr(result, "structured_content", None)
    if isinstance(value, dict):
        return value
    for key in ("structuredContent", "structured_content"):
        if isinstance(dumped.get(key), dict):
            return dumped[key]
    data = getattr(result, "data", None)
    return data if isinstance(data, dict) else {}


def tool_result_to_dict(result: Any) -> dict[str, Any]:
    dumped = {
        "content": jsonable(getattr(result, "content", [])),
        "structured_content": jsonable(getattr(result, "structured_content", None)),
        "is_error": jsonable(getattr(result, "is_error", False)),
    }
    data = getattr(result, "data", None)
    if data is not None and dumped["structured_content"] is None:
        dumped["data"] = jsonable(data)
    return redacted(dumped)


def result_is_error(result: Any, dumped: dict[str, Any]) -> bool:
    value = getattr(result, "is_error", None)
    if isinstance(value, bool):
        return value
    for key in ("isError", "is_error"):
        if isinstance(dumped.get(key), bool):
            return dumped[key]
    return False


async def call_tool(client: Client, name: str, arguments: dict[str, Any], meta: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    result = await client.call_tool(name=name, arguments=arguments, meta=meta or None, raise_on_error=False)
    dumped = tool_result_to_dict(result)
    if result_is_error(result, dumped):
        raise RuntimeError(json.dumps(dumped, separators=(",", ":")))
    return result, dumped


def write_jsonl_record(handle: Any, record: dict[str, Any]) -> None:
    handle.write(json.dumps(redacted(record), separators=(",", ":")) + "\n")
    handle.flush()


def normalize_roster_item(line_number: int, raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Split a roster line into plan_call arguments, MCP meta, and clinic metadata.

    Roster line shape:
      {
        "clinic_id": "hcii-kapeeka",
        "clinic_name": "Kapeeka HC II",
        "nurse_name": "Jane",
        "to_phones": ["+256700000001"],
        "region": "UG",
        "language": "English",
        "metadata": {"district": "Nakaseke"}
      }
    """
    clinic_meta = {key: raw[key] for key in ("clinic_id", "clinic_name", "nurse_name") if key in raw and raw[key] is not None}
    if not clinic_meta.get("clinic_id"):
        raise ValueError(f"Line {line_number} is missing clinic_id")
    if "metadata" in raw and isinstance(raw["metadata"], dict):
        mcp_meta = {"call-e/customerMetadata": {**raw["metadata"], **clinic_meta}}
    else:
        mcp_meta = {"call-e/customerMetadata": dict(clinic_meta)}
    goal = questionnaire.build_goal(
        clinic_id=clinic_meta["clinic_id"],
        clinic_name=str(clinic_meta.get("clinic_name") or clinic_meta["clinic_id"]),
        nurse_name=clinic_meta.get("nurse_name"),
    )
    arguments: dict[str, Any] = {
        "to_phones": raw["to_phones"],
        "region": raw.get("region", "UG"),
        "language": raw.get("language", "English"),
        "goal": goal,
        "user_input": raw.get("user_input") or f"Weekly HMIS stock and cold-chain report call to {clinic_meta.get('clinic_name') or clinic_meta['clinic_id']}.",
    }
    if not isinstance(arguments["to_phones"], list) or not arguments["to_phones"]:
        raise ValueError(f"Line {line_number} is missing to_phones")
    return arguments, mcp_meta, clinic_meta


async def poll_call_run(client: Client, config: Config, run_id: str, meta: dict[str, Any], timeout_seconds: float) -> tuple[dict[str, Any], str | None, str | None]:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    poll_index = 0
    last_dumped: dict[str, Any] = {}
    last_status: str | None = None
    while True:
        poll_index += 1
        result, dumped = await call_tool(client, "get_call_run", {"run_id": run_id}, meta)
        structured = structured_content(result, dumped)
        status = extract_status(structured) or extract_status(dumped) or "UNKNOWN"
        last_dumped = dumped
        last_status = status
        if status in TERMINAL_STATUSES:
            return last_dumped, last_status, extract_post_summary(last_dumped)
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError(f"Timed out waiting for terminal status for run_id={run_id}")
        await asyncio.sleep(config.poll_interval_seconds)


async def process_batch(config: Config, token: str, items: list[tuple[int, dict[str, Any]]], console: Console) -> int:
    headers = {"Authorization": f"Bearer {token}", "X-Call-E-Integration": INTEGRATION_HEADER}
    transport = StreamableHttpTransport(config.server_url, headers=headers)
    store = Store(config.db_path)
    config.output_path.parent.mkdir(parents=True, exist_ok=True)
    failures = 0
    async with Client(transport) as client:
        with config.output_path.open("w", encoding="utf-8") as output:
            for line_number, raw in items:
                try:
                    arguments, mcp_meta, clinic_meta = normalize_roster_item(line_number, raw)
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
                    "duration_seconds": None,
                    "run_id": None,
                    "final_status": None,
                    "post_summary": None,
                    "report": None,
                }
                started_monotonic = time.perf_counter()
                try:
                    plan_result, plan_dumped = await call_tool(client, "plan_call", arguments, mcp_meta)
                    plan_structured = structured_content(plan_result, plan_dumped)
                    record["plan_result"] = plan_dumped
                    if config.mode == "dry_run":
                        record["ok"] = True
                        console.print(f"[green]dry_run ok[/] line {line_number} {clinic_meta['clinic_id']}")
                    else:
                        if not plan_structured.get("ready_to_run"):
                            raise RuntimeError("plan_call did not return ready_to_run=true")
                        plan_id = plan_structured.get("plan_id")
                        confirm_token = plan_structured.get("confirm_token")
                        if not isinstance(plan_id, str) or not isinstance(confirm_token, str):
                            raise RuntimeError("plan_call did not return plan_id and confirm_token")
                        record["started_at"] = iso_timestamp(utc_now())
                        run_result, run_dumped = await call_tool(client, "run_call", {"plan_id": plan_id, "confirm_token": confirm_token}, mcp_meta)
                        run_structured = structured_content(run_result, run_dumped)
                        run_id = run_structured.get("run_id")
                        if not isinstance(run_id, str) or not run_id:
                            raise RuntimeError("run_call did not return run_id")
                        record["run_id"] = run_id
                        final_dumped, final_status, post_summary = await poll_call_run(
                            client, config, run_id, mcp_meta, config.poll_timeout_seconds
                        )
                        record["ended_at"] = iso_timestamp(utc_now())
                        record["duration_seconds"] = time.perf_counter() - started_monotonic
                        record["final_status"] = final_status
                        record["post_summary"] = post_summary
                        report = questionnaire.parse_report(post_summary or "", clinic_id=clinic_meta["clinic_id"])
                        record["report"] = {
                            "fields": report.fields,
                            "missing": report.missing,
                            "invalid": report.invalid,
                            "red_flags": report.red_flags,
                            "severity": report.severity,
                            "raw": report.raw,
                        }
                        if final_status == "COMPLETED":
                            record["ok"] = True
                            store.ingest(clinic_meta, report, record)
                            console.print(f"[green]ok[/] {clinic_meta['clinic_id']} {report.severity} flags={report.red_flags}")
                        else:
                            store.ingest(clinic_meta, report, record)
                            console.print(f"[yellow]non-complete[/] {clinic_meta['clinic_id']} status={final_status}")
                except Exception as error:
                    record["error"] = {"type": type(error).__name__, "message": str(error)}
                    console.print(f"[red]failed[/] line {line_number} {clinic_meta['clinic_id']}: {type(error).__name__}: {error}")
                    failures += 1
                write_jsonl_record(output, record)
    console.print(f"[bold]Done.[/] {config.output_path}  db={config.db_path}  failures={failures}")
    return 0 if failures == 0 else 1


def run(argv: list[str] | None = None) -> int:
    console = Console()
    config = read_config(argv)
    token = ensure_access_token(config, console)
    raw_items = load_jsonl(config.input_path)
    if not raw_items:
        raise ValueError(f"No JSONL records found in {config.input_path}")
    console.print(f"[green]Loaded[/] {len(raw_items)} clinic record(s) from {config.input_path}")
    return asyncio.run(process_batch(config, token, raw_items, console))


def main() -> int:
    try:
        return run()
    except AuthRequiredError as error:
        Console(stderr=True).print(f"[red]Auth required:[/] {error}")
        return 2
    except CliUnavailableError as error:
        Console(stderr=True).print(f"[red]CLI unavailable:[/] {error}")
        return 3
    except Exception as error:
        Console(stderr=True).print(f"[red]Error:[/] {type(error).__name__}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
