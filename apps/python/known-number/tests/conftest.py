import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from known_number.models import load_request, load_vendors  # noqa: E402


@pytest.fixture(scope="session")
def request_v0417():
    return load_request(ROOT / "examples" / "change_request.json")


@pytest.fixture(scope="session")
def vendors():
    return load_vendors(ROOT / "examples" / "vendors.json")


@pytest.fixture(scope="session")
def vendor_v0417(vendors):
    return vendors["V-0417"]


def load_fixture(name: str) -> dict:
    return json.loads((ROOT / "fixtures" / f"{name}.json").read_text(encoding="utf-8"))
