import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))


def _load(name):
    return json.loads((APP / "examples" / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in ("CALLE_API_KEY", "CALLE_BASE_URL", "NOSHOWZERO_ALLOWED_DESTINATIONS", "NOSHOWZERO_WEBHOOK_TOKEN"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def clinic():
    return _load("clinic.json")


@pytest.fixture
def appointment():
    return _load("appointment.json")


@pytest.fixture
def waitlist():
    return _load("waitlist.json")


@pytest.fixture
def reminder_call():
    return _load("fictional_reminder_call.json")


@pytest.fixture
def offer_call():
    return _load("fictional_offer_call.json")
