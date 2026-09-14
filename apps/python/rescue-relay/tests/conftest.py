import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as relay
import calling
from coordinator import Coordinator


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(relay, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(relay, "CALL_MODE", "mock")
    monkeypatch.setattr(relay, "ENABLE_LIVE_CALLS", False)
    monkeypatch.setattr(relay, "CALLE_API_KEY", "")
    monkeypatch.setattr(relay, "APP_ENV", "test")
    monkeypatch.setattr(calling, "MOCK_DELAY_SECONDS", .005)
    monkeypatch.setenv("LLM_MODE", "auto")
    monkeypatch.setenv("LLM_FALLBACK", "true")
    for key in ("LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_ALLOWED_ORIGINS"):
        monkeypatch.setenv(key, "")
    monkeypatch.setattr(relay, "planner", Coordinator())
    with TestClient(relay.app, base_url="http://localhost", client=("127.0.0.1", 50000)) as c:
        yield c
