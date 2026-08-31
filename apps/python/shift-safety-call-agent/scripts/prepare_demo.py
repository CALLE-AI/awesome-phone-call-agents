"""Create one fresh, fictional four-record demo; never start a server or call."""

from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from tempfile import mkdtemp

from shift_safety_call_agent.adapters.fake_call_provider import FakeCallProvider
from shift_safety_call_agent.adapters.sqlite_repository import SqliteInterviewRepository
from shift_safety_call_agent.application.services import InterviewService
from shift_safety_call_agent.domain.models import SafetyInterview


def prepare_demo(runtime_root: Path = Path("runtime")) -> Path:
    """Create a unique demo directory, leaving every existing database untouched."""

    runtime_root.mkdir(parents=True, exist_ok=True)
    demo_directory = Path(mkdtemp(prefix="demo-", dir=runtime_root))
    database = demo_directory / "records.db"
    repository = SqliteInterviewRepository(database)
    repository.initialize()
    fixed_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
    identifiers = count(1)
    provider = FakeCallProvider(
        id_generator=lambda: f"fake-demo-{next(identifiers):03d}",
        clock=lambda: fixed_time,
    )
    service = InterviewService(provider, repository, clock=lambda: fixed_time)
    for index, scenario in enumerate(provider.available_scenarios(), start=1):
        service.execute(
            SafetyInterview(
                interview_id=f"fictional-demo-{index:03d}",
                created_at=fixed_time,
                scenario_name=scenario,
                recipient_alias="demo-worker",
            )
        )
    return database


if __name__ == "__main__":
    demo_path = prepare_demo().relative_to(Path.cwd())
    print("Created four fictional Fake Provider records. No call was placed.")
    print("Start the loopback review server manually:")
    print(
        "shift-safety-call-agent serve-api --db-path "
        f"{demo_path.as_posix()} --port 8765"
    )
    print("Then open http://127.0.0.1:8765/app. Stop the server with Ctrl+C.")
