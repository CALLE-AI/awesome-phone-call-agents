import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
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
    assert "--runtime-user-email quotewake.runtime@example.com" in result.stdout
    assert "--runtime-user-username quotewake.runtime@example.com" in result.stdout
    assert "Initial setup: deploy metadata, provision the runtime user" in result.stdout
    assert "Later demo reset: seed/reset data; runtime-user options are not needed." in result.stdout
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


def test_demo_quotes_expire_in_three_months():
    script = SCRIPT.read_text()

    assert "calendar.monthrange(year, month)" in script
    assert "ExpirationDate=$QUOTE_EXPIRATION_DATE" in script
    assert "+30 days" not in script
    assert "date -u" not in script


def test_utc_date_helper_computes_consistent_eligibility_values():
    script = SCRIPT.read_text()
    start = script.index("utc_date_value() {")
    end = script.index("\n}\n\non_error", start) + 2
    helper = script[start:end]
    result = subprocess.run(
        [
            "bash",
            "-c",
            f'{helper}\nutc_date_value "$@"',
            "utc-date-test",
            "eligibility",
            "3600",
            "1800",
            "86400",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    query_now = datetime.strptime(values["query_now"], "%Y-%m-%dT%H:%M:%SZ")
    standard_cutoff = datetime.strptime(values["standard_cutoff"], "%Y-%m-%dT%H:%M:%SZ")
    minimum_cutoff = datetime.strptime(values["minimum_cutoff"], "%Y-%m-%dT%H:%M:%SZ")
    assert query_now - standard_cutoff == timedelta(hours=1)
    assert query_now - minimum_cutoff == timedelta(minutes=30)
    assert values["today"] == query_now.date().isoformat()
    assert values["due_soon_date"] == (query_now + timedelta(days=1)).date().isoformat()


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
    assert "profiles/QuoteWake Runtime.profile-meta.xml" in script
    assert 'uv run --project "$APP_DIR" --directory "$APP_DIR" python -c' in script


def test_runtime_user_options_are_required_together_and_provision_before_app_setup():
    script = SCRIPT.read_text()

    assert '[[ -n "$RUNTIME_USER_EMAIL" && -n "$RUNTIME_USER_USERNAME" ]]' in script
    deployment = script.index('sf project deploy start')
    provisioning = script.index('create-user.sh')
    assert deployment < provisioning
    assert '"$SCRIPT_DIR/create-user.sh"' in script
    assert 'configure_external_client_app' in script


def test_setup_declares_quote_wake_external_client_app_and_runtime_policy():
    app_root = ROOT / "salesforce" / "force-app" / "main" / "default"
    app = (app_root / "externalClientApps" / "QuoteWake_Integration.eca-meta.xml").read_text()
    global_oauth = (
        app_root
        / "extlClntAppGlobalOauthSets"
        / "QuoteWake_Integration.ecaGlblOauth-meta.xml"
    ).read_text()
    oauth = (app_root / "extlClntAppOauthSettings" / "QuoteWake_Integration.ecaOauth-meta.xml").read_text()
    script = SCRIPT.read_text()

    assert "<label>QuoteWake Integration</label>" in app
    assert "<isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>" in global_oauth
    assert "<commaSeparatedOauthScopes>Api</commaSeparatedOauthScopes>" in oauth
    assert "<clientCredentialsFlowUser>$RUNTIME_USER_USERNAME</clientCredentialsFlowUser>" in script
    assert "<commaSeparatedPermissionSet>$permission_set_name</commaSeparatedPermissionSet>" in script
    assert "AdminApprovedPreAuthorized" in script
    assert '--target-org "$USER_TARGET_ORG"' in script


def test_reset_uses_one_generation_marker_for_every_demo_quote():
    script = SCRIPT.read_text()

    assert "RESET_GENERATION_AT=''" in script
    assert script.count('RESET_GENERATION_AT="$(utc_date_value reset-marker)"') == 1
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
    seed_update = 'sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --record-id "$existing_id" --values "$structural_values"'
    assert seed_update in script
    assert 'create_values="$structural_values QuoteWake_Enabled__c=true Attempt_Count__c=0"' in script


def test_generation_marker_does_not_change_initial_status_null_readiness_query():
    script = SCRIPT.read_text()

    assert "Follow_Up_Status__c = null AND (LastModifiedDate <= $INITIAL_STANDARD_CUTOFF" in script
    assert "Follow_Up_Status__c = null AND Next_Follow_Up_At__c" not in script


def test_optional_salesforce_arguments_use_bash_3_nounset_safe_expansion():
    scripts = [
        ROOT / "scripts" / "create-user.sh",
        ROOT / "scripts" / "query-quotes.sh",
        ROOT / "scripts" / "setup-salesforce.sh",
        ROOT / "scripts" / "update-quote.sh",
    ]

    for path in scripts:
        expansions = [line for line in path.read_text().splitlines() if "ORG_ARGS[@]" in line]
        assert expansions
        assert all('${ORG_ARGS[@]+"${ORG_ARGS[@]}"}' in line for line in expansions)
