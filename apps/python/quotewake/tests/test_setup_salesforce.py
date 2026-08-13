import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

from quotewake_salesforce.calle.client import idempotency_key

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
    assert "default: US" in result.stdout
    assert "--call-locale LOCALE" in result.stdout
    assert "default: en_US" in result.stdout
    assert "new idempotency generation" in result.stdout
    assert "primary Opportunity Contact Role's Contact phone" in result.stdout
    assert "--test-phones +14155550100" in result.stdout
    assert "trailing backslash" in result.stdout


def test_regional_options_accept_case_and_separator_variants_before_help():
    result = run_setup("--country-code", "pt", "--call-locale", "PT-pt", "--help")

    assert result.returncode == 0
    assert run_setup("--call-locale", "en_US", "--help").returncode == 0


@pytest.mark.parametrize(
    ("option", "value", "message"),
    [
        ("--country-code", "ESP", "Invalid country code"),
        ("--country-code", "E!", "Invalid country code"),
        ("--call-locale", "spanish-ES", "Invalid call locale"),
        ("--call-locale", "en_US_POSIX", "Invalid call locale"),
    ],
)
def test_regional_options_reject_invalid_formats(option: str, value: str, message: str):
    result = run_setup(option, value)

    assert result.returncode != 0
    assert message in result.stderr


def test_seed_writes_regional_options_to_accounts_and_contacts():
    script = SCRIPT.read_text()

    assert "COUNTRY_CODE='US'" in script
    assert "CALL_LOCALE='en_US'" in script
    assert "BillingCountryCode=$COUNTRY_CODE" in script
    assert "QuoteWake_Call_Locale__c='$CALL_LOCALE'" in script
    assert script.count("Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE") == 9


def test_reset_preserves_existing_contact_phone_without_explicit_test_phones():
    script = SCRIPT.read_text()

    assert "if ((${#TEST_PHONES[@]} > 0)); then" in script
    assert "preserve both Phone and MobilePhone exactly" in script
    assert "do not query," in script
    assert "copy, clear, or include either phone field" in script
    assert "values=\"FirstName='$first_name' LastName='$last_name' AccountId=$account_id Email=$email QuoteWake_Call_Locale__c='$CALL_LOCALE'\"" in script


def test_explicit_test_phone_updates_both_contact_phone_fields():
    script = SCRIPT.read_text()

    assert 'if ((${#TEST_PHONES[@]} > 0)); then' in script
    assert 'values="$values Phone=$phone MobilePhone=$phone"' in script


@pytest.mark.parametrize(
    ("phone", "mobile_phone"),
    [("", "+14155550121"), ("+14155550122", "+14155550123")],
)
def test_existing_contact_phone_fields_survive_mocked_reset(phone: str, mobile_phone: str, tmp_path: Path):
    """Execute ensure_contact with mocked Salesforce and verify both fields survive."""

    script = SCRIPT.read_text()
    start = script.index("ensure_contact() {")
    end = script.index("\n}\n\nensure_primary_contact_role", start) + 2
    ensure_contact = script[start:end]
    state_file = tmp_path / "contact-state"
    harness = f"""
set -euo pipefail
ORG_ARGS=()
TEST_PHONES=()
CALL_LOCALE=en_US
query_id() {{ printf '003000000000001\\n'; }}
create_msg() {{ :; }}
sf() {{
    local values='' arg
    while (($#)); do
        if [[ "$1" == '--values' ]]; then
            values="$2"
            shift 2
        else
            shift
        fi
    done
    if [[ " $values " == *' Phone='* || " $values " == *' MobilePhone='* ]]; then
        printf 'changed|changed\\n' > "$STATE_FILE"
    else
        printf '%s|%s\\n' "$FIXTURE_PHONE" "$FIXTURE_MOBILE_PHONE" > "$STATE_FILE"
    fi
}}
{ensure_contact}
ensure_contact 001000000000001 Marta Garcia marta@example.invalid +14155550139
"""
    result = subprocess.run(
        ["bash", "-c", harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "STATE_FILE": str(state_file),
            "FIXTURE_PHONE": phone,
            "FIXTURE_MOBILE_PHONE": mobile_phone,
        },
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert state_file.read_text().strip() == f"{phone}|{mobile_phone}"


def test_demo_verification_confirms_region_and_locale_without_printing_phones():
    script = SCRIPT.read_text()

    assert "BillingCountryCode" in script
    assert "Contact.QuoteWake_Call_Locale__c" in script
    assert "Contact.Phone" not in script
    assert "SELECT Id, Name, Phone FROM Account" not in script


def test_setup_loads_timing_and_retry_policy_before_mutating_salesforce():
    script = SCRIPT.read_text()

    config_load = script.index('TIMING_JSON=')
    first_mutation = script.index('sf project deploy start')
    assert config_load < first_mutation
    assert "load_initial_follow_up_timing" in script
    assert "load_follow_up_policies" in script
    assert '"minimum_seconds": int(timing.minimum_delay.total_seconds())' in script
    assert '"standard_seconds": int(timing.standard_delay.total_seconds())' in script
    assert '"due_soon_seconds": int(timing.due_soon_window.total_seconds())' in script
    assert '"max_attempts": policies.retry.max_attempts' in script
    assert "MAX_ATTEMPTS=\"$(jq -r '.max_attempts' <<<\"$TIMING_JSON\")\"" in script
    assert "Attempt_Count__c < $MAX_ATTEMPTS" in script
    assert "Attempt_Count__c < 3" not in script
    assert 'uv run --project "$APP_DIR" --directory "$APP_DIR" python -c' in script


def test_reset_uses_one_generation_marker_for_every_demo_quote():
    script = SCRIPT.read_text()

    assert "RESET_GENERATION_AT=''" in script
    assert script.count('RESET_GENERATION_AT="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"') == 1
    assert "Follow_Up_Status__c= Next_Follow_Up_At__c=$RESET_GENERATION_AT Attempt_Count__c=0" in script
    assert "generation $RESET_GENERATION_AT" in script


def test_reset_generation_changes_call_key_but_normal_seed_reuses_it():
    first_generation = datetime(2026, 8, 13, 10, 30, 0, 123000, tzinfo=timezone.utc)
    second_generation = datetime(2026, 8, 13, 10, 30, 0, 124000, tzinfo=timezone.utc)

    first_key = idempotency_key("0Q0000000000001", 1, first_generation)
    second_key = idempotency_key("0Q0000000000001", 1, second_generation)
    assert first_key != second_key
    assert idempotency_key("0Q0000000000001", 1, first_generation) == first_key

    script = SCRIPT.read_text()
    seed_update = "sf data update record \"${ORG_ARGS[@]}\" --sobject Quote --record-id \"$existing_id\" --values \"$structural_values\""
    assert seed_update in script
    assert 'create_values="$structural_values QuoteWake_Enabled__c=true Attempt_Count__c=0"' in script


def test_generation_marker_does_not_change_initial_status_null_readiness_query():
    script = SCRIPT.read_text()

    assert "Follow_Up_Status__c = null AND (LastModifiedDate <= $INITIAL_STANDARD_CUTOFF" in script
    assert "Follow_Up_Status__c = null AND Next_Follow_Up_At__c" not in script
