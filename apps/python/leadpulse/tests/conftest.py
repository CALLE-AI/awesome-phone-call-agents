import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in ("CALLE_API_KEY", "CALLE_BASE_URL", "LEADPULSE_ALLOWED_DESTINATIONS", "LEADPULSE_WEBHOOK_TOKEN"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def business():
    return json.loads((APP / "examples" / "business.json").read_text(encoding="utf-8"))


@pytest.fixture
def form():
    return json.loads((APP / "examples" / "form_submission.json").read_text(encoding="utf-8"))


@pytest.fixture
def completed_call():
    return json.loads((APP / "examples" / "fictional_completed_call.json").read_text(encoding="utf-8"))
