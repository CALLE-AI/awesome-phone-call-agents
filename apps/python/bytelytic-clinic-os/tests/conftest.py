import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

import pytest
from bytelytic_clinic.config import ClinicConfig
from bytelytic_clinic.adapters.calle_adapter import CalleAdapter
from bytelytic_clinic.adapters.ehr_adapter import SimulatedEHRAdapter
from bytelytic_clinic.adapters.audit_ledger import AuditLedger


@pytest.fixture
def mock_config():
    return ClinicConfig(
        calle_api_key="calle_test_key",
        dry_run=True,
        app_api_key="bytelytic_demo_key_2026",
        authorized_recipients=["+15550192834", "+15550192835"],
    )


@pytest.fixture
def mock_calle_adapter(mock_config):
    return CalleAdapter(mock_config)


@pytest.fixture
def ehr_store():
    return SimulatedEHRAdapter()


@pytest.fixture
def fresh_audit_ledger():
    return AuditLedger()


@pytest.fixture(autouse=True)
def reset_global_adapter_state():
    from bytelytic_clinic.adapters.calle_adapter import calle_adapter
    calle_adapter.cfg.dry_run = True
    calle_adapter.policy.dry_run = True
    yield
    calle_adapter.cfg.dry_run = True
    calle_adapter.policy.dry_run = True

