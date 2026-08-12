from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "setup-salesforce.sh"


def run_setup(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_help_documents_regional_seed_options_without_external_dependencies():
    result = run_setup("--help")

    assert result.returncode == 0
    assert "--country-code CODE" in result.stdout
    assert "default: ES" in result.stdout
    assert "--call-locale LOCALE" in result.stdout
    assert "default: es-ES" in result.stdout


def test_regional_options_accept_case_variants_before_help():
    result = run_setup("--country-code", "pt", "--call-locale", "PT-pt", "--help")

    assert result.returncode == 0


@pytest.mark.parametrize(
    ("option", "value", "message"),
    [
        ("--country-code", "ESP", "Invalid country code"),
        ("--country-code", "E!", "Invalid country code"),
        ("--call-locale", "es_ES", "Invalid call locale"),
        ("--call-locale", "spanish-ES", "Invalid call locale"),
    ],
)
def test_regional_options_reject_invalid_formats(option: str, value: str, message: str):
    result = run_setup(option, value)

    assert result.returncode != 0
    assert message in result.stderr


def test_seed_writes_regional_options_to_accounts_and_contacts():
    script = SCRIPT.read_text()

    assert "COUNTRY_CODE='ES'" in script
    assert "CALL_LOCALE='es-ES'" in script
    assert "BillingCountryCode=$COUNTRY_CODE" in script
    assert "QuoteWake_Call_Locale__c='$CALL_LOCALE'" in script
