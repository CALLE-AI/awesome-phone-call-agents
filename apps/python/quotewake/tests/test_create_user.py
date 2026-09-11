import os
import subprocess
from pathlib import Path
from textwrap import dedent
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "create-user.sh"
PERMISSION_SET = (
    ROOT
    / "salesforce"
    / "force-app"
    / "main"
    / "default"
    / "permissionsets"
    / "QuoteWake_User.permissionset-meta.xml"
)


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_help_and_argument_validation_do_not_need_salesforce():
    result = run_script("--help")

    assert result.returncode == 0
    assert "--target-org ALIAS_OR_USERNAME" in result.stdout
    assert "--email EMAIL" in result.stdout
    assert "--username USERNAME" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--resend-welcome" in result.stdout

    invalid = run_script(
        "--target-org",
        "runtime-org",
        "--email",
        "not-an-email",
        "--username",
        "runtime@example.com",
    )
    assert invalid.returncode != 0
    assert "Invalid email" in invalid.stderr


def test_permission_set_includes_quote_wake_runtime_api_access():
    root = ET.parse(PERMISSION_SET).getroot()
    namespace = "{http://soap.sforce.com/2006/04/metadata}"
    objects = {
        item.findtext(f"{namespace}object"): item
        for item in root.findall(f"{namespace}objectPermissions")
    }

    assert root.findtext(f"{namespace}label") == "QuoteWake User"
    user_permissions = {
        item.findtext(f"{namespace}name")
        for item in root.findall(f"{namespace}userPermissions")
    }
    assert {"ApiEnabled"} <= user_permissions
    for object_name in (
        "Account",
        "Contact",
        "Opportunity",
        "Pricebook2",
        "PricebookEntry",
        "Product2",
        "Quote",
        "QuoteLineItem",
    ):
        assert objects[object_name].findtext(f"{namespace}allowRead") == "true"
        assert objects[object_name].findtext(f"{namespace}allowEdit") == (
            "true" if object_name == "Quote" else "false"
        )
        assert objects[object_name].findtext(f"{namespace}allowDelete") == "false"
        assert objects[object_name].findtext(f"{namespace}viewAllRecords") == "false"
        assert objects[object_name].findtext(f"{namespace}modifyAllRecords") == "false"
    assert objects["Task"].findtext(f"{namespace}allowCreate") == "true"
    assert objects["Task"].findtext(f"{namespace}allowDelete") == "false"
    fields = {
        item.findtext(f"{namespace}field")
        for item in root.findall(f"{namespace}fieldPermissions")
    }
    assert {
        "Quote.QuoteWake_Enabled__c",
        "Quote.Follow_Up_Status__c",
        "Quote.Next_Follow_Up_At__c",
        "Quote.Attempt_Count__c",
        "Quote.ExpirationDate",
        "Quote.Status",
        "Contact.QuoteWake_Call_Locale__c",
        "Contact.MobilePhone",
        "Contact.Phone",
        "Opportunity.AccountId",
        "Product2.QuantityUnitOfMeasure",
        "QuoteLineItem.TotalPrice",
    } <= fields
    assert {
        "Task.ActivityDate",
        "Task.Description",
        "Task.WhatId",
        "Task.WhoId",
    } <= fields


def test_user_provisioning_reconciles_contact_view_and_account_layout():
    script = SCRIPT.read_text()

    assert "--source-dir force-app/main/default/objects/Contact" in script
    assert "profiles/$PROFILE_NAME.profile-meta.xml" in script
    contact_list_view = (
        ROOT
        / "salesforce"
        / "force-app"
        / "main"
        / "default"
        / "objects"
        / "Contact"
        / "listViews"
        / "All_Contacts.listView-meta.xml"
    )
    assert contact_list_view.exists()
    assert "<fullName>All_Contacts</fullName>" in contact_list_view.read_text()


def _fake_sf(tmp_path: Path) -> tuple[Path, Path]:
    log = tmp_path / "sf.log"
    fake = tmp_path / "sf"
    fake.write_text(
        dedent(
            """
            #!/usr/bin/env bash
            set -euo pipefail
            args="$*"
            printf '%s\n' "$args" >> "${FAKE_SF_LOG}"
            if [[ "$args" == *"org display"* ]]; then
              printf '%s\n' '{"status":0,"result":{"instanceUrl":"https://example.my.salesforce.com"}}'
            elif [[ "$args" == *"project deploy start"* ]]; then
              printf '%s\n' '{"status":0,"result":{"status":"Succeeded"}}'
            elif [[ "$args" == *"FROM Organization"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":1,"records":[{"OrganizationType":"Developer Edition","TimeZoneSidKey":"Europe/Madrid","DefaultLocaleSidKey":"es_ES","LanguageLocaleKey":"en_US"}]}}'
            elif [[ "$args" == *"FROM Profile"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":1,"records":[{"Id":"00e000000000001","Name":"Minimum Access - Salesforce","UserLicense":{"Name":"Salesforce"}}]}}'
            elif [[ "$args" == *"FROM UserLicense"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":1,"records":[{"Name":"Salesforce","TotalLicenses":10,"UsedLicenses":1,"Status":"Active"}]}}'
            elif [[ "$args" == *"FROM User WHERE"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":0,"records":[]}}'
            elif [[ "$args" == *"FROM PermissionSetAssignment"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":0,"records":[]}}'
            elif [[ "$args" == *"data query"* ]]; then
              printf '%s\n' '{"status":0,"result":{"totalSize":1,"records":[{"Id":"001000000000001","Name":"Fixture"}]}}'
            elif [[ "$args" == *"data create record"* ]]; then
              printf '%s\n' '{"status":0,"result":{"id":"005000000000001","success":true}}'
            fi
            """
        ).strip()
        + "\n"
    )
    fake.chmod(0o755)
    return fake, log


def test_dry_run_never_creates_assigns_or_resets(tmp_path: Path):
    fake, log = _fake_sf(tmp_path)
    result = run_script(
        "--target-org",
        "runtime-org",
        "--email",
        "runtime@example.com",
        "--username",
        "quotewake.runtime@example.com",
        "--dry-run",
        env={
            **os.environ,
            "PATH": f"{fake.parent}:{os.environ['PATH']}",
            "FAKE_SF_LOG": str(log),
        },
    )

    assert result.returncode == 0, result.stderr
    assert "Dry run complete" in result.stdout
    calls = log.read_text()
    assert "--dry-run" in calls
    assert "SELECT Id, Subject FROM Task LIMIT 1" in calls
    assert "data create record" not in calls
    assert "org assign permset" not in calls
    assert "api request rest" not in calls
    assert "data update record" not in calls


def test_real_mode_creates_assigns_and_requests_welcome_without_password(tmp_path: Path):
    fake, log = _fake_sf(tmp_path)
    result = run_script(
        "--target-org",
        "runtime-org",
        "--email",
        "runtime@example.com",
        "--username",
        "quotewake.runtime@example.com",
        env={
            **os.environ,
            "PATH": f"{fake.parent}:{os.environ['PATH']}",
            "FAKE_SF_LOG": str(log),
        },
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text()
    assert "data create record" in calls
    assert "org assign permset" in calls
    assert "api request rest" in calls
    assert "Password=" not in calls
    assert "--password" not in calls
