from __future__ import annotations

import pathlib
import sys

import pytest

from callibrate.calling.models import CallEvidence, CallOutcome, Claim, Confirmation, Turn
from callibrate.config import Settings
from callibrate.contracts.models import Subject, Trigger, TriggerType, VerificationContract
from callibrate.store import Store

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))


@pytest.fixture
def settings(tmp_path: pathlib.Path) -> Settings:
    return Settings(
        environment="test",
        database_path=tmp_path / "callibrate.db",
        secret_key="test-secret-key-that-is-long-enough-32",
        caller_mode="pilot",
        bootstrap_sample_data=True,
        minimum_call_interval_days=0,
        allowed_hosts="localhost,127.0.0.1,testserver",
    )


@pytest.fixture
def store(settings: Settings) -> Store:
    store = Store(settings.database_path)
    store.initialize()
    store.seed_demo(settings)
    return store


@pytest.fixture
def contract() -> VerificationContract:
    return VerificationContract(
        id="vc_test",
        subject=Subject(name="Weekly grocery pickup", organization="Meridian Community Pantry", record_id="svc_food"),
        authoritative_phone="+15550101101",
        current_record={"schedule": "WE 09:00-12:00", "status": "active"},
        fields_to_verify=["schedule"],
        trigger=Trigger(type=TriggerType.STALE_RECORD, message=""),
    )


def turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    """CALL-E-shaped raw turns: `bot` and `user`, exactly as the API returns them."""
    return [{"speaker": speaker, "text": text} for speaker, text in pairs]


def evidence_with(contract: VerificationContract, **overrides) -> CallEvidence:
    base = {
        "contract_id": contract.id,
        "caller": "test",
        "outcome": CallOutcome.COMPLETED,
        "disclosure_spoken": True,
        "transcript": [Turn(id="t1", role="assistant", text="hello")],
    }
    base.update(overrides)
    return CallEvidence(**base)


__all__ = ["Claim", "Confirmation", "evidence_with", "turns"]
