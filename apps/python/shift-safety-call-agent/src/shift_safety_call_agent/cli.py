"""Safe CLI for local workflows and one explicitly permitted live self-call."""

import argparse
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import TextIO
from uuid import uuid4

from shift_safety_call_agent.adapters.fake_call_provider import FakeCallProvider
from shift_safety_call_agent.adapters.memory_repository import MemoryInterviewRepository
from shift_safety_call_agent.adapters.sqlite_repository import (
    CURRENT_SCHEMA_VERSION,
    SqliteInterviewRepository,
)
from shift_safety_call_agent.adapters.calle_sdk import (
    CalleSdkInfo,
    CalleSdkInspectionError,
    inspect_calle_sdk,
)
from shift_safety_call_agent.adapters.calle_live import (
    EXACT_EXECUTION_PERMIT,
    CalleRuntimeBoundaryError,
    LiveCallOutcome,
    LiveCallPreflight,
    build_redacted_runtime_evidence,
    build_live_call_preflight,
    execute_one_live_call,
    require_live_call_readiness,
)
from shift_safety_call_agent.adapters.calle_sdk_adapter import CalleSdkProviderError
from shift_safety_call_agent.application.calle_planning import (
    CALLE_PREVIEW_SCENARIOS,
    create_calle_plan,
    create_calle_preview_plan,
)
from shift_safety_call_agent.application.ports import InterviewRepository
from shift_safety_call_agent.application.repository_errors import RepositoryError
from shift_safety_call_agent.application.services import InterviewService, utc_now
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterview, SafetyInterviewResult


DEFAULT_DATABASE_PATH = Path("runtime/app.db")
DEFAULT_LOCAL_API_PORT = 8765


def _new_id() -> str:
    return str(uuid4())


def _local_api_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("port must be an integer") from None
    if not 1024 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1024 and 65535")
    return port


def _read_project_version() -> str:
    try:
        return (Path(__file__).resolve().parents[2] / "VERSION").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        return "unknown"


def _tri_state(value: bool | None) -> str:
    if value is None:
        return "unknown"
    return str(value).lower()


def format_result(result: SafetyInterviewResult) -> str:
    """Format reported facts separately from the derived assessment."""

    evidence = "\n".join(f"- {item}" for item in result.evidence) or "- none"
    incident_level = result.incident_level.value if result.incident_level is not None else "unknown"
    follow_up = _tri_state(result.requires_follow_up)
    confidence = "unknown" if result.confidence is None else f"{result.confidence:.2f}"
    return "\n".join(
        (
            "FACT",
            f"- Near miss reported: {_tri_state(result.near_miss_occurred)}",
            f"- Equipment issue reported: {_tri_state(result.equipment_issue_occurred)}",
            f"- Injury reported: {_tri_state(result.injury_or_health_issue)}",
            "- Evidence:",
            evidence,
            "",
            "ASSESSMENT",
            f"- Incident level: {incident_level}",
            f"- Follow-up required: {follow_up}",
            f"- Confidence: {confidence}",
            f"- Summary: {result.summary}",
        )
    )


def format_calle_preview(plan: CallPlan, *, show_task: bool = False) -> str:
    """Format a no-call plan without loading credentials or provider code."""

    required = plan.result_schema.get("required")
    fields = ", ".join(required) if isinstance(required, tuple) else "unknown"
    sections = [
        "\n".join(
            (
                "MODE",
                "- Dry run only",
                "- No CALL-E request will be sent",
                "- No phone call will be placed",
                "",
                "PLAN",
                f"- Scenario: {plan.scenario_name}",
                f"- Recipient alias: {plan.recipient_alias}",
                f"- Region: {plan.region}",
                f"- Language: {plan.language}",
                f"- Human confirmation required: {str(plan.requires_human_confirmation).lower()}",
                "",
                "RESULT SCHEMA",
                f"- Expected fields: {fields}",
                f"- Incident levels: {', '.join(level.value for level in IncidentLevel)}",
                "",
                "SAFETY",
                f"- Real phone number included: {str(plan.contains_real_phone_number).lower()}",
                "- API key loaded: false",
                "- CALL-E SDK loaded: false",
                "- Network access attempted: false",
            )
        )
    ]
    if show_task:
        sections.append(f"TASK\n{plan.task}")
    return "\n\n".join(sections)


def format_calle_sdk_info(info: CalleSdkInfo) -> str:
    """Format non-sensitive local package facts only."""

    version = info.version if info.version is not None else "not installed"
    return "\n".join(
        (
            "CALL-E SDK",
            f"- Installed: {str(info.installed).lower()}",
            f"- Distribution: {info.distribution}",
            f"- Version: {version}",
            f"- Import: {info.import_name}",
            f"- Client class available: {str(info.client_class_available).lower()}",
            "- Network attempted: false",
            "- Client instantiated: false",
            "- API key loaded: false",
            "- Phone number loaded: false",
        )
    )


def format_live_call_preflight(preflight: LiveCallPreflight) -> str:
    """Format only non-sensitive readiness facts and an unconditional no-call notice."""

    return "\n".join(
        (
            "LIVE CALL PREFLIGHT",
            f"- Provider selected: {preflight.provider}",
            f"- CALLE_API_KEY: {'set' if preflight.api_key_set else 'not set'}",
            f"- Recipient: {'set' if preflight.recipient_set else 'not set'}",
            f"- Recipient format valid: {str(preflight.recipient_format_valid).lower()}",
            f"- Live-call enabled: {str(preflight.live_call_enabled).lower()}",
            (
                "- Human confirmation matches: "
                f"{str(preflight.human_confirmation_matches).lower()}"
            ),
            f"- CALL-E client factory ready: {str(preflight.client_factory_ready).lower()}",
            "- Real call WILL NOT be placed",
        )
    )


def _safe_provider_status(value: str) -> str:
    if value in {"queued", "in_progress", "completed", "failed", "canceled"}:
        return value
    return "unknown"


def format_live_call_outcome(outcome: LiveCallOutcome) -> str:
    """Format selected state only; never render recipient, transcript, or raw payload."""

    confidence = outcome.snapshot.completion_confidence
    redacted_evidence = build_redacted_runtime_evidence(outcome)
    return "\n".join(
        (
            "LIVE CALL RESULT",
            "- Task version: en-safety-v2",
            "- Result schema version: safety-result-v1",
            "- Provider identifiers: withheld",
            f"- Status: {_safe_provider_status(outcome.snapshot.raw_status)}",
            f"- Task completed: {_tri_state(outcome.snapshot.task_completed)}",
            f"- Review disposition: {redacted_evidence['review_disposition']}",
            (
                "- Completion confidence: absent"
                if confidence is None
                else "- Completion confidence: present (score and label; not a safety score)"
            ),
            (
                "- Structured result: safely normalized"
                if outcome.normalized_result is not None
                else "- Structured result: not safely normalized"
            ),
            f"- Evidence count: {len(outcome.snapshot.evidence)}",
            f"- Summary: {'available' if outcome.snapshot.summary else 'not available'}",
            "- Transcript persisted: false",
        )
    )


def _display_database_path(path: Path) -> str:
    """Return a useful path label without exposing an absolute parent path."""

    if path == DEFAULT_DATABASE_PATH:
        return DEFAULT_DATABASE_PATH.as_posix()
    return "<custom-database>"


def _optional(value: object | None) -> str:
    return "unknown" if value is None else str(value)


def _safe_display_text(value: str | None) -> str:
    """Collapse control whitespace in safe persisted text before display."""

    return "unknown" if value is None else " ".join(value.split())


def format_stored_interview(interview: SafetyInterview) -> str:
    """Format persisted detail without evidence text, tasks, or transcripts."""

    result = interview.result
    return "\n".join(
        (
            "FACT",
            f"- Work summary: {_safe_display_text(result.work_summary if result else None)}",
            f"- Near miss: {_tri_state(result.near_miss_occurred if result else None)}",
            f"- Equipment issue: {_tri_state(result.equipment_issue_occurred if result else None)}",
            f"- Injury or health issue: {_tri_state(result.injury_or_health_issue if result else None)}",
            f"- Handover notes: {_safe_display_text(result.handover_notes if result else None)}",
            "",
            "ASSESSMENT",
            f"- Incident level: {result.incident_level.value if result and result.incident_level else 'unknown'}",
            f"- Follow-up required: {_tri_state(result.requires_follow_up if result else None)}",
            f"- Confidence: {_optional(result.confidence if result else None)}",
            "",
            "PROVENANCE",
            f"- Provider: {_safe_display_text(interview.call_provider)}",
            "- Provider run ID: withheld",
            f"- Created at: {interview.created_at.isoformat()}",
            f"- Completed at: {_optional(interview.completed_at.isoformat() if interview.completed_at else None)}",
            f"- Evidence count: {len(result.evidence) if result else 0}",
        )
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the offline CLI parser."""

    parser = argparse.ArgumentParser(prog="shift-safety-call-agent")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("scenarios", help="list fictional fake-provider scenarios")
    run_parser = subparsers.add_parser("run-fake", help="run one fictional interview")
    run_parser.add_argument("--scenario", required=True, choices=FakeCallProvider.available_scenarios())
    run_parser.add_argument("--save", action="store_true", help="save to the local SQLite database")
    run_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    preview_parser = subparsers.add_parser(
        "preview-calle",
        help="preview an offline CALL-E plan without a request or call",
    )
    preview_parser.add_argument("--scenario", required=True, choices=CALLE_PREVIEW_SCENARIOS)
    preview_parser.add_argument("--show-task", action="store_true")
    subparsers.add_parser("calle-sdk-info", help="inspect the optional SDK without a client or network")
    subparsers.add_parser(
        "live-preflight",
        help="inspect guarded CALL-E readiness without constructing a client or placing a call",
    )
    live_call_parser = subparsers.add_parser(
        "live-call-self",
        help="place at most one guarded CALL-E call to the configured owned recipient",
    )
    live_call_parser.add_argument(
        "--save",
        action="store_true",
        help="save only a safely normalized result to the local SQLite database",
    )
    live_call_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    subparsers.add_parser("list", help="list interviews in the current in-memory repository")
    db_init_parser = subparsers.add_parser("db-init", help="initialize the local SQLite database")
    db_init_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    db_list_parser = subparsers.add_parser("db-list", help="list locally persisted interviews")
    db_list_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    db_show_parser = subparsers.add_parser("db-show", help="show one locally persisted interview")
    db_show_parser.add_argument("--id", required=True)
    db_show_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    serve_parser = subparsers.add_parser(
        "serve-api", help="serve the Fake Provider API on localhost only"
    )
    serve_parser.add_argument("--db-path", type=Path, default=DEFAULT_DATABASE_PATH)
    serve_parser.add_argument(
        "--port", type=_local_api_port, default=DEFAULT_LOCAL_API_PORT
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    output: TextIO | None = None,
    repository: InterviewRepository | None = None,
    clock: Callable[[], datetime] = utc_now,
    id_generator: Callable[[], str] = _new_id,
    sdk_inspector: Callable[[], CalleSdkInfo] = inspect_calle_sdk,
    environment: Mapping[str, str] | None = None,
    live_preflight_builder: Callable[[Mapping[str, str]], LiveCallPreflight] = (
        build_live_call_preflight
    ),
    input_reader: Callable[[], str] = input,
    live_call_runner: Callable[
        [CallPlan, str | None, Mapping[str, str]], LiveCallOutcome
    ] = execute_one_live_call,
    live_readiness_checker: Callable[[Mapping[str, str]], None] = (
        require_live_call_readiness
    ),
) -> int:
    """Run one selected CLI operation; live execution remains interactive and gated."""

    stream = output or sys.stdout
    args = build_parser().parse_args(argv)

    if args.command == "serve-api":
        try:
            from shift_safety_call_agent.adapters.web.server import serve_local_api
        except ModuleNotFoundError:
            print(
                "Local Web API dependencies are not installed. "
                "Install the pinned 'web' optional dependency in the project .venv.",
                file=stream,
            )
            return 2
        return serve_local_api(
            repository=SqliteInterviewRepository(args.db_path),
            database_label=_display_database_path(args.db_path),
            port=args.port,
            app_version=_read_project_version(),
            output=stream,
        )

    if args.command in {"db-init", "db-list", "db-show"}:
        sqlite_repo = SqliteInterviewRepository(args.db_path)
        try:
            schema_version = sqlite_repo.initialize()
            if args.command == "db-init":
                print(
                    "\n".join(
                        (
                            "DATABASE",
                            f"- Path: {_display_database_path(args.db_path)}",
                            f"- Schema version: {schema_version}",
                            "- Initialized: true",
                        )
                    ),
                    file=stream,
                )
                return 0
            if args.command == "db-list":
                interviews = sqlite_repo.list()
                if not interviews:
                    print("No persisted interviews.", file=stream)
                    return 0
                for interview in interviews:
                    result = interview.result
                    incident = (
                        result.incident_level.value
                        if result is not None and result.incident_level is not None
                        else "unknown"
                    )
                    follow_up = _tri_state(result.requires_follow_up if result else None)
                    print(
                        "\n".join(
                            (
                                "INTERVIEW",
                                f"- Interview ID: {_safe_display_text(interview.interview_id)}",
                                f"- Created at: {interview.created_at.isoformat()}",
                                f"- Scenario: {_safe_display_text(interview.scenario_name)}",
                                f"- Status: {interview.status.value}",
                                f"- Incident level: {incident}",
                                f"- Follow-up required: {follow_up}",
                                f"- Provider: {_safe_display_text(interview.call_provider)}",
                            )
                        ),
                        file=stream,
                    )
                return 0
            interview = sqlite_repo.get(args.id)
            if interview is None:
                print("Persisted interview was not found.", file=stream)
                return 2
            print(format_stored_interview(interview), file=stream)
            return 0
        except RepositoryError as error:
            print(f"Local database error: {error}", file=stream)
            return 2

    if args.command == "scenarios":
        for scenario in FakeCallProvider.available_scenarios():
            print(scenario, file=stream)
        return 0

    if args.command == "list":
        repo = repository or MemoryInterviewRepository()
        interviews = repo.list()
        if not interviews:
            print("No interviews are stored in this process.", file=stream)
            return 0
        for interview in interviews:
            print(f"{interview.interview_id}\t{interview.status.value}\t{interview.scenario_name}", file=stream)
        return 0

    if args.command == "preview-calle":
        plan = create_calle_preview_plan(
            args.scenario,
            id_generator=id_generator,
            clock=clock,
        )
        print(format_calle_preview(plan, show_task=args.show_task), file=stream)
        return 0

    if args.command == "calle-sdk-info":
        try:
            sdk_info = sdk_inspector()
        except CalleSdkInspectionError as error:
            print(f"CALL-E SDK\n- Inspection error: {error}", file=stream)
            return 2
        print(format_calle_sdk_info(sdk_info), file=stream)
        return 0

    if args.command == "live-preflight":
        runtime_environment = os.environ if environment is None else environment
        preflight = live_preflight_builder(runtime_environment)
        print(format_live_call_preflight(preflight), file=stream)
        return 0

    if args.command == "live-call-self":
        runtime_environment = os.environ if environment is None else environment
        try:
            live_readiness_checker(runtime_environment)
        except CalleRuntimeBoundaryError as error:
            print(f"Live call stopped: {error}", file=stream)
            return 2
        try:
            interactive_input = sys.stdin is not None and sys.stdin.isatty() is True
        except Exception:
            interactive_input = False
        if not interactive_input:
            print(
                "Live call stopped: execution permit requires an interactive terminal.",
                file=stream,
            )
            return 2
        interview_id = id_generator()
        plan = create_calle_plan(
            "live-self-test",
            "fictional-self-test",
            interview_id=interview_id,
            id_generator=id_generator,
            clock=clock,
        )
        print(
            "FINAL EXECUTION PERMIT\n"
            f"Type exactly: {EXACT_EXECUTION_PERMIT}\n"
            "Any other input stops before the CALL-E request boundary.",
            file=stream,
        )
        try:
            execution_permit = input_reader()
        except (EOFError, KeyboardInterrupt):
            print("Live call stopped: execution permit was not provided.", file=stream)
            return 2
        if execution_permit != EXACT_EXECUTION_PERMIT:
            print("Live call stopped: exact execution permit did not match.", file=stream)
            return 2
        try:
            outcome = live_call_runner(plan, execution_permit, runtime_environment)
        except (CalleRuntimeBoundaryError, CalleSdkProviderError) as error:
            print(f"Live call stopped: {error}", file=stream)
            return 2

        print(format_live_call_outcome(outcome), file=stream)
        if not args.save:
            print("- Structured result saved: false (not requested)", file=stream)
            return 0
        if outcome.normalized_result is None:
            print(
                "- Structured result saved: false (safe normalization unavailable)",
                file=stream,
            )
            return 1
        completed_at = clock()
        completed = SafetyInterview(
            interview_id=interview_id,
            created_at=plan.created_at,
            scenario_name="live-self-test",
            recipient_alias="fictional-self-test",
            status=InterviewStatus.COMPLETED,
            call_provider="calle",
            call_provider_run_id=None,
            started_at=plan.created_at,
            completed_at=completed_at,
            result=outcome.normalized_result,
        )
        try:
            SqliteInterviewRepository(args.db_path).save(completed)
        except RepositoryError as error:
            print(f"- Structured result saved: false ({error})", file=stream)
            return 2
        print("- Structured result saved: true", file=stream)
        print(f"- Interview ID: {interview_id}", file=stream)
        print(f"- Database: {_display_database_path(args.db_path)}", file=stream)
        print(f"- Schema version: {CURRENT_SCHEMA_VERSION}", file=stream)
        return 0

    repo: InterviewRepository
    if args.save:
        repo = SqliteInterviewRepository(args.db_path)
    else:
        repo = repository or MemoryInterviewRepository()
    interview = SafetyInterview(
        interview_id=id_generator(),
        created_at=clock(),
        scenario_name=args.scenario,
        recipient_alias="fictional-worker",
    )
    try:
        completed = InterviewService(FakeCallProvider(), repo, clock).execute(interview)
    except RepositoryError as error:
        print(f"Local database error: {error}", file=stream)
        return 2
    if completed.result is None:
        print("The fake interview did not produce a result.", file=stream)
        return 1
    print(format_result(completed.result), file=stream)
    if args.save:
        print(
            "\n".join(
                (
                    "",
                    "PERSISTENCE",
                    "- Saved: true",
                    f"- Interview ID: {completed.interview_id}",
                    f"- Database: {_display_database_path(args.db_path)}",
                    f"- Schema version: {CURRENT_SCHEMA_VERSION}",
                )
            ),
            file=stream,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
