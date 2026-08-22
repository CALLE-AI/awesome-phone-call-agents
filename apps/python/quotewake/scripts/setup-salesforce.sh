#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SALESFORCE_DIR="$APP_DIR/salesforce"
TARGET_ORG=""
SEED_DATA=false
RESET_DATA=false
ASSIGN_PERMISSIONS=false
RUNTIME_USER_EMAIL=""
RUNTIME_USER_USERNAME=""
CHANGES_APPLIED=false
DEMO_QUOTE_PREFIX='QuoteWake Demo - '
EXTERNAL_CLIENT_APP='QuoteWake_Integration'
TEST_PHONES=()
COUNTRY_CODE='US'
CALL_LOCALE='en_US'
RESET_GENERATION_AT=''

info() { printf '[INFO] %s\n' "$1"; }
ok() { printf '[OK] %s\n' "$1"; }
create_msg() { printf '[CREATE] %s\n' "$1" >&2; }
fail() { printf '[ERROR] %s\n' "$1" >&2; exit 1; }

utc_date_value() {
    local operation="$1"
    shift
    python3 - "$operation" "$@" <<'PY'
import calendar
import json
import sys
from datetime import datetime, timedelta, timezone

operation = sys.argv[1]
now = datetime.now(timezone.utc)
if operation == "today":
    print(now.date().isoformat())
elif operation == "add-months":
    months = int(sys.argv[2])
    month_index = now.year * 12 + now.month - 1 + months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    day = min(now.day, calendar.monthrange(year, month)[1])
    print(now.date().replace(year=year, month=month, day=day).isoformat())
elif operation == "reset-marker":
    print(now.isoformat(timespec="milliseconds").replace("+00:00", "Z"))
elif operation == "eligibility":
    standard_seconds, minimum_seconds, due_soon_seconds = map(int, sys.argv[2:5])
    print(json.dumps({
        "query_now": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "standard_cutoff": (now - timedelta(seconds=standard_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "minimum_cutoff": (now - timedelta(seconds=minimum_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "due_soon_date": (now + timedelta(seconds=due_soon_seconds)).date().isoformat(),
        "today": now.date().isoformat(),
    }))
else:
    raise SystemExit(f"Unknown UTC date operation: {operation}")
PY
}

on_error() {
    printf '\n[ERROR] Command failed: %s\n' "$BASH_COMMAND" >&2
    if [[ "$CHANGES_APPLIED" == true ]]; then
        printf '[ERROR] Changes were already applied. Re-run safely; deployment and demo records are idempotent.\n' >&2
    else
        printf '[ERROR] No Salesforce change was recorded by this script before the failure.\n' >&2
    fi
    printf '[ERROR] Check the command output above and retry after correcting the problem.\n' >&2
}
trap on_error ERR

usage() {
    cat <<'EOF'
Configure the Salesforce metadata and demo data used by QuoteWake.

QuoteWake calls the primary Opportunity Contact Role's Contact phone. Account
Phone is commercial reference data and is not used as the CALL-E recipient.

Usage: ./scripts/setup-salesforce.sh [options]

Options:
  --target-org ALIAS       Salesforce CLI alias or username to modify.
  --seed-data              Create or update 10 Quotes, 10 Opportunities and 9 Accounts.
  --country-code CODE      ISO 3166-1 alpha-2 country code for demo Accounts (default: US).
  --call-locale LOCALE     Salesforce locale for demo Contacts (default: en_US;
                           en-US and other canonical BCP-47 forms are accepted).
  --test-phones LIST       Comma-separated E.164 phone numbers for demo Contacts.
                           One number is used for every Contact; multiple numbers
                           are assigned randomly. Requires --seed-data or --reset-data.
  --reset-data             Seed the demo hierarchy, delete its Tasks, reset QuoteWake state,
                           and start a new idempotency generation.
  --assign-permissions     Assign QuoteWake_User to the current target-org user.
  --runtime-user-email EMAIL       Initial setup: create or reconcile the runtime user.
  --runtime-user-username USERNAME  Globally unique username for the runtime user.
                                   Both runtime-user options are required together;
                                   omit both for later --reset-data runs.
  -h, --help               Show this help.

Examples:
  # Initial setup: deploy metadata, provision the runtime user, and configure OAuth.
  ./scripts/setup-salesforce.sh \
    --target-org quotewake-dev \
    --runtime-user-email quotewake.runtime@example.com \
    --runtime-user-username quotewake.runtime@example.com

  # Later demo reset: seed/reset data; runtime-user options are not needed.
  ./scripts/setup-salesforce.sh --reset-data \
    --target-org quotewake-dev \
    --country-code US \
    --call-locale en_US \
    --test-phones +14155550100

The reset example updates all 10 demo Contacts to the authorized test number,
sets their locale to en_US, sets demo Accounts to US, removes Tasks linked to
the demo Quotes, resets their follow-up state, and starts a new idempotency
generation. Keep each option and its value in the same shell command; use a
trailing backslash when splitting the command across lines.
EOF
}

parse_test_phones() {
    local value="$1" phone existing
    local -a candidates
    IFS=',' read -r -a candidates <<<"$value"
    ((${#candidates[@]} > 0)) || fail "--test-phones requires at least one E.164 phone number."
    for phone in "${candidates[@]}"; do
        # Trim optional whitespace around comma-separated values.
        phone="${phone#"${phone%%[![:space:]]*}"}"
        phone="${phone%"${phone##*[![:space:]]}"}"
        [[ "$phone" =~ ^\+[1-9][0-9]{7,14}$ ]] || \
        fail "Invalid test phone '$phone'. Use E.164 format, for example +14155550100."
        for existing in ${TEST_PHONES[@]+"${TEST_PHONES[@]}"}; do
            [[ "$existing" != "$phone" ]] || fail "Duplicate test phone: $phone"
        done
        TEST_PHONES+=("$phone")
    done
}

parse_country_code() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z]{2}$ ]] || \
        fail "Invalid country code '$value'. Use an ISO 3166-1 alpha-2 code, for example ES."
    COUNTRY_CODE="$(printf '%s' "$value" | LC_ALL=C tr '[:lower:]' '[:upper:]')"
}

parse_call_locale() {
    local value="$1" language region
    [[ "$value" =~ ^[A-Za-z]{2,3}([_-][A-Za-z]{2}|[_-][0-9]{3})?$ ]] || \
        fail "Invalid call locale '$value'. Use a locale such as en_US or en-US."

    language="${value%%[-_]*}"
    language="$(printf '%s' "$language" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
    if [[ "$value" == *[-_]* ]]; then
        region="${value#*[-_]}"
        if [[ "$region" =~ ^[A-Za-z]{2}$ ]]; then
            region="$(printf '%s' "$region" | LC_ALL=C tr '[:lower:]' '[:upper:]')"
        fi
        # Salesforce's locale field uses the CLDR underscore spelling.  The
        # QuoteWake domain boundary converts this to BCP-47 for CALL-E.
        CALL_LOCALE="${language}_${region}"
    else
        CALL_LOCALE="$language"
    fi
}

while (($#)); do
    case "$1" in
        --target-org)
            (($# >= 2)) || fail "--target-org requires an alias or username."
            TARGET_ORG="$2"
            shift 2
            ;;
        --seed-data)
            SEED_DATA=true
            shift
            ;;
        --country-code)
            (($# >= 2)) || fail "--country-code requires an ISO 3166-1 alpha-2 code."
            parse_country_code "$2"
            shift 2
            ;;
        --call-locale)
            (($# >= 2)) || fail "--call-locale requires a BCP-47 locale."
            parse_call_locale "$2"
            shift 2
            ;;
        --test-phones)
            (($# >= 2)) || fail "--test-phones requires a comma-separated phone list."
            parse_test_phones "$2"
            shift 2
            ;;
        --reset-data)
            RESET_DATA=true
            shift
            ;;
        --assign-permissions)
            ASSIGN_PERMISSIONS=true
            shift
            ;;
        --runtime-user-email)
            (($# >= 2)) || fail "--runtime-user-email requires an email address."
            [[ -z "$RUNTIME_USER_EMAIL" ]] || fail "--runtime-user-email may only be supplied once."
            RUNTIME_USER_EMAIL="$2"
            shift 2
            ;;
        --runtime-user-username)
            (($# >= 2)) || fail "--runtime-user-username requires a username."
            [[ -z "$RUNTIME_USER_USERNAME" ]] || fail "--runtime-user-username may only be supplied once."
            RUNTIME_USER_USERNAME="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown option: $1"
            ;;
    esac
done

if [[ -n "$RUNTIME_USER_EMAIL" || -n "$RUNTIME_USER_USERNAME" ]]; then
    [[ -n "$RUNTIME_USER_EMAIL" && -n "$RUNTIME_USER_USERNAME" ]] || \
        fail "--runtime-user-email and --runtime-user-username must be supplied together."
fi

if [[ "$RESET_DATA" == true ]]; then
    # Reset always seeds first so the hierarchy and its stable Quote identifiers exist.
    SEED_DATA=true
fi

if ((${#TEST_PHONES[@]} > 0)) && [[ "$SEED_DATA" != true ]]; then
    fail "--test-phones requires --seed-data or --reset-data."
fi

test_phone_for_contact() {
    local fallback="$1"
    if ((${#TEST_PHONES[@]} == 0)); then
        printf '%s\n' "$fallback"
    elif ((${#TEST_PHONES[@]} == 1)); then
        printf '%s\n' "${TEST_PHONES[0]}"
    else
        printf '%s\n' "${TEST_PHONES[RANDOM % ${#TEST_PHONES[@]}]}"
    fi
}

command -v sf >/dev/null 2>&1 || fail "Salesforce CLI (sf) is not installed or is not on PATH."
command -v jq >/dev/null 2>&1 || fail "jq is required to inspect Salesforce CLI JSON responses."
command -v uv >/dev/null 2>&1 || fail "uv is required to load the QuoteWake project configuration."
[[ -d "$SALESFORCE_DIR" ]] || fail "Salesforce project directory not found: $SALESFORCE_DIR"

TIMING_JSON="$(
    # --project selects dependencies, while --directory also makes the local
    # QuoteWake package importable when this script is launched from scripts/
    # or any other working directory.
    uv run --project "$APP_DIR" --directory "$APP_DIR" python -c '
import json
import sys
from pathlib import Path
from quotewake_salesforce.config import load_initial_follow_up_timing
from quotewake_salesforce.config import load_follow_up_policies

config_path = Path(sys.argv[1])
timing = load_initial_follow_up_timing(config_path)
policies = load_follow_up_policies(config_path)
print(json.dumps({
    "minimum_seconds": int(timing.minimum_delay.total_seconds()),
    "standard_seconds": int(timing.standard_delay.total_seconds()),
    "due_soon_seconds": int(timing.due_soon_window.total_seconds()),
    "max_attempts": policies.retry.max_attempts,
}))
' "$APP_DIR/quotewake.toml"
)"
MINIMUM_DELAY_SECONDS="$(jq -r '.minimum_seconds' <<<"$TIMING_JSON")"
STANDARD_DELAY_SECONDS="$(jq -r '.standard_seconds' <<<"$TIMING_JSON")"
DUE_SOON_SECONDS="$(jq -r '.due_soon_seconds' <<<"$TIMING_JSON")"
MAX_ATTEMPTS="$(jq -r '.max_attempts' <<<"$TIMING_JSON")"

ORG_ARGS=()
if [[ -n "$TARGET_ORG" ]]; then
    ORG_ARGS=(--target-org "$TARGET_ORG")
fi

info "Checking Salesforce CLI..."
SF_VERSION="$(sf --version | head -n 1)"
info "Using $SF_VERSION"
if [[ -n "$TARGET_ORG" ]]; then
    info "Target org: $TARGET_ORG"
else
    info "Target org: current Salesforce CLI default org"
fi

ORG_ERROR_FILE="$(mktemp)"
if ! ORG_JSON="$(sf org display ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --json 2>"$ORG_ERROR_FILE")"; then
    printf '[ERROR] sf org display failed: %s\n' "$(tr '\n' ' ' <"$ORG_ERROR_FILE")" >&2
    rm -f "$ORG_ERROR_FILE"
    fail "Salesforce authentication is missing or the target org is unreachable. Run 'sf org login web --alias quotewake-dev --set-default' and retry."
fi
rm -f "$ORG_ERROR_FILE"
# Support both the standard sf JSON envelope and CLI versions that return the
# org information directly at the top level.
ORG_USERNAME="$(jq -r '(.result // .) | .username // .orgUsername // empty' <<<"$ORG_JSON")"
ORG_ID="$(jq -r '(.result // .) | .orgId // .orgID // .id // empty' <<<"$ORG_JSON")"
CONNECTED="$(jq -r '(.result // .) | .connectedStatus // .connected // empty' <<<"$ORG_JSON")"
[[ -n "$ORG_USERNAME" && -n "$ORG_ID" ]] || fail "Salesforce CLI did not return an org username and org ID."
[[ -z "$CONNECTED" || "$CONNECTED" == "Connected" ]] || fail "Salesforce org connection is not healthy (status: $CONNECTED)."
printf '[INFO] Org username: %s\n' "$ORG_USERNAME"
printf '[INFO] Org ID: %s\n' "$ORG_ID"
ok "Salesforce connection verified"

QUOTE_SCHEMA="$(sf sobject describe ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --json 2>/dev/null)" || \
    fail "The standard Quote object is unavailable in this org. No Salesforce changes were attempted."
[[ "$(jq -r '.result.name // empty' <<<"$QUOTE_SCHEMA")" == "Quote" ]] || \
    fail "Salesforce did not return the standard Quote object metadata."
ok "Quote object available"

info "Enabling standard Quotes through deployable QuoteSettings metadata..."
if ! (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --source-dir force-app/main/default/settings --wait 30 --concise); then
    printf '[ERROR] Salesforce rejected QuoteSettings deployment.\n' >&2
    printf '[ERROR] Manual step: Setup -> Quote Settings -> check Enable Quotes -> Save, then rerun this script.\n' >&2
    exit 1
fi
CHANGES_APPLIED=true
if ! sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id FROM Quote LIMIT 1" --result-format csv >/dev/null; then
    printf '[ERROR] The Quote object is still not queryable after QuoteSettings deployment.\n' >&2
    printf '[ERROR] Manual step: Setup -> Quote Settings -> check Enable Quotes -> Save, then rerun this script.\n' >&2
    exit 1
fi
ok "Quotes are enabled"

info "Deploying QuoteWake fields and permission set..."
    (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --source-dir force-app/main/default/objects/Quote --source-dir force-app/main/default/objects/Contact --source-dir force-app/main/default/permissionsets --source-dir 'force-app/main/default/profiles/QuoteWake Runtime.profile-meta.xml' --wait 30 --concise)
CHANGES_APPLIED=true
ok "QuoteWake metadata deployment completed"

if [[ -n "$RUNTIME_USER_EMAIL" ]]; then
    USER_TARGET_ORG="$TARGET_ORG"
    if [[ -z "$USER_TARGET_ORG" ]]; then
        USER_TARGET_ORG="$ORG_USERNAME"
    fi
    info "Provisioning the dedicated QuoteWake runtime Salesforce user..."
    "$SCRIPT_DIR/create-user.sh" \
        --target-org "$USER_TARGET_ORG" \
        --email "$RUNTIME_USER_EMAIL" \
        --username "$RUNTIME_USER_USERNAME"
    ok "Dedicated QuoteWake runtime Salesforce user is ready"
fi

configure_external_client_app() {
    local permission_set_name policy_dir policy_file policy_error_file

    [[ -n "$RUNTIME_USER_USERNAME" ]] || \
        fail "A runtime username is required to configure the External Client App."

    info "Deploying the QuoteWake External Client App OAuth settings..."
    if ! (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --source-dir "force-app/main/default/externalClientApps/$EXTERNAL_CLIENT_APP.eca-meta.xml" \
        --source-dir "force-app/main/default/extlClntAppGlobalOauthSets/$EXTERNAL_CLIENT_APP.ecaGlblOauth-meta.xml" \
        --source-dir "force-app/main/default/extlClntAppOauthSettings/$EXTERNAL_CLIENT_APP.ecaOauth-meta.xml" \
        --wait 30 --concise >/dev/null 2>&1); then
        fail "QuoteWake External Client App deployment failed."
    fi

    permission_set_name="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --query "SELECT Name FROM PermissionSet WHERE Name = 'QuoteWake_User' LIMIT 1" \
        --json | jq -r '.result.records[0].Name // empty')"
    [[ -n "$permission_set_name" ]] || fail "Could not resolve the QuoteWake_User permission set."

    # Salesforce CLI determines the metadata type from the source directory.
    # Keep the generated policy in the corresponding source-format directory;
    # placing the XML at the temporary directory root makes the deployment
    # fail with an unhelpful generic error.
    policy_dir="$(mktemp -d "$SALESFORCE_DIR/.quotewake-policy.XXXXXX")"
    mkdir -p "$policy_dir/extlClntAppOauthPolicies"
    policy_file="$policy_dir/extlClntAppOauthPolicies/${EXTERNAL_CLIENT_APP}_defaultPolicy.ecaOauthPlcy-meta.xml"
    cat >"$policy_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthConfigurablePolicies xmlns="http://soap.sforce.com/2006/04/metadata">
    <clientCredentialsFlowUser>$RUNTIME_USER_USERNAME</clientCredentialsFlowUser>
    <commaSeparatedPermissionSet>$permission_set_name</commaSeparatedPermissionSet>
    <externalClientApplication>$EXTERNAL_CLIENT_APP</externalClientApplication>
    <ipRelaxationPolicyType>Enforce</ipRelaxationPolicyType>
    <isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>
    <isGuestCodeCredFlowEnabled>false</isGuestCodeCredFlowEnabled>
    <isTokenExchangeFlowEnabled>false</isTokenExchangeFlowEnabled>
    <label>${EXTERNAL_CLIENT_APP}_defaultPolicy</label>
    <permittedUsersPolicyType>AdminApprovedPreAuthorized</permittedUsersPolicyType>
    <refreshTokenPolicyType>SpecificLifetime</refreshTokenPolicyType>
    <refreshTokenValidityPeriod>365</refreshTokenValidityPeriod>
    <refreshTokenValidityUnit>Days</refreshTokenValidityUnit>
    <requiredSessionLevel>STANDARD</requiredSessionLevel>
</ExtlClntAppOauthConfigurablePolicies>
EOF

    info "Configuring Client Credentials Run As user and pre-authorized permission set..."
    policy_error_file="$(mktemp)"
    if ! (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --source-dir "$policy_dir/extlClntAppOauthPolicies" --wait 30 --concise >"$policy_error_file" 2>&1); then
        sed -n '1,120p' "$policy_error_file" >&2
        rm -f "$policy_error_file"
        rm -rf "$policy_dir"
        fail "QuoteWake External Client App policy deployment failed."
    fi
    rm -f "$policy_error_file"
    rm -rf "$policy_dir"
    ok "QuoteWake External Client App is configured for $RUNTIME_USER_USERNAME"
    info "Retrieve the Consumer Key and Secret from the External Client App OAuth settings and store them in .env or a secret manager."
}

if [[ -n "$RUNTIME_USER_EMAIL" ]]; then
    configure_external_client_app
fi

if [[ "$ASSIGN_PERMISSIONS" == true ]]; then
    CURRENT_USER_ID="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id FROM User WHERE Username = '$ORG_USERNAME' LIMIT 1" --json | jq -r '.result.records[0].Id // empty')"
    [[ -n "$CURRENT_USER_ID" ]] || fail "Could not resolve the authenticated Salesforce user ID for permission assignment."
    PERMISSION_ASSIGNMENT_ID="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '$CURRENT_USER_ID' AND PermissionSet.Name = 'QuoteWake_User' LIMIT 1" --json | jq -r '.result.records[0].Id // empty')"
    if [[ -n "$PERMISSION_ASSIGNMENT_ID" ]]; then
        ok "QuoteWake_User is already assigned"
    else
        info "Assigning QuoteWake_User to the current authenticated Salesforce user..."
        sf org assign permset ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --name QuoteWake_User
        ok "QuoteWake_User assigned"
    fi
fi

verify_fields() {
    local schema="$1"
    local field
    local fields=(QuoteWake_Enabled__c Follow_Up_Status__c Next_Follow_Up_At__c Attempt_Count__c)
    for field in "${fields[@]}"; do
        if jq -e --arg field "$field" '.result.fields[] | select(.name == $field)' <<<"$schema" >/dev/null; then
            ok "$field exists"
        else
            fail "Expected Quote field $field was not found after deployment."
        fi
    done
}

info "Verifying QuoteWake fields..."
QUOTE_SCHEMA="$(sf sobject describe ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --json)"
verify_fields "$QUOTE_SCHEMA"

required_create_fields() {
    local object="$1"
    local schema
    schema="$(sf sobject describe ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject "$object" --json)"
    jq -r '.result.fields[] | select(.createable == true and .nillable == false and .defaultedOnCreate == false) | .name' <<<"$schema"
}

check_required_fields() {
    local object="$1"
    local supported="$2"
    local field
    while IFS= read -r field; do
        [[ -z "$field" ]] && continue
        [[ " $supported " == *" $field "* ]] || fail "The $object schema has an additional required createable field: $field. The seed operation stopped without guessing its value."
    done < <(required_create_fields "$object")
}

ensure_product() {
    local product_code="$1" name="$2" description="$3" existing_id values
    existing_id="$(query_id "SELECT Id FROM Product2 WHERE ProductCode = '$product_code' LIMIT 1")"
    values="Name='$name' ProductCode=$product_code Description='$description' IsActive=true"
    if [[ -n "$existing_id" ]]; then
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Product2 --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "Product2: $name"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Product2 --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_pricebook_entry() {
    local product_id="$1" unit_price="$2" existing_id values
    existing_id="$(query_id "SELECT Id FROM PricebookEntry WHERE Pricebook2Id = '$PRICEBOOK_ID' AND Product2Id = '$product_id' LIMIT 1")"
    values="Pricebook2Id=$PRICEBOOK_ID Product2Id=$product_id UnitPrice=$unit_price IsActive=true"
    if [[ -n "$existing_id" ]]; then
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject PricebookEntry --record-id "$existing_id" --values "UnitPrice=$unit_price IsActive=true" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "PricebookEntry: $product_id"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject PricebookEntry --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_quote_line() {
    local quote_id="$1" product_id="$2" pricebook_entry_id="$3" quantity="$4" unit_price="$5" description="$6"
    local existing_id values
    existing_id="$(query_id "SELECT Id FROM QuoteLineItem WHERE QuoteId = '$quote_id' AND PricebookEntryId = '$pricebook_entry_id' LIMIT 1")"
    values="QuoteId=$quote_id PricebookEntryId=$pricebook_entry_id Product2Id=$product_id Quantity=$quantity UnitPrice=$unit_price Description='$description'"
    if [[ -n "$existing_id" ]]; then
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject QuoteLineItem --record-id "$existing_id" --values "Quantity=$quantity UnitPrice=$unit_price Description='$description'" >/dev/null
    else
        create_msg "QuoteLineItem: $description"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject QuoteLineItem --values "$values" >/dev/null
    fi
}

query_id() {
    local query="$1"
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$query" --json | jq -r '.result.records[0].Id // empty'
}

ensure_record() {
    local object="$1" name="$2" values="$3" existing_id
    existing_id="$(query_id "SELECT Id FROM $object WHERE Name = '$name' LIMIT 1")"
    if [[ -n "$existing_id" ]]; then
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject "$object" --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "$object: $name"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject "$object" --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_contact() {
    local account_id="$1" first_name="$2" last_name="$3" email="$4" phone="$5" existing_id values
    existing_id="$(query_id "SELECT Id FROM Contact WHERE Email = '$email' LIMIT 1")"
    if [[ -n "$existing_id" ]]; then
        # A reset must preserve both Phone and MobilePhone exactly.  Salesforce
        # partial updates leave omitted fields unchanged, so do not query,
        # copy, clear, or include either phone field without --test-phones.
        values="FirstName='$first_name' LastName='$last_name' AccountId=$account_id Email=$email QuoteWake_Call_Locale__c='$CALL_LOCALE'"
        if ((${#TEST_PHONES[@]} > 0)); then
            # QuoteWake prefers MobilePhone over Phone. An explicit authorized
            # test number must replace both fields so no stale recipient can
            # override the requested demo destination.
            values="$values Phone=$phone MobilePhone=$phone"
        fi
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Contact --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "Contact: $first_name $last_name"
        # New Contacts need a safe fixture fallback unless an authorized test
        # number was explicitly supplied.
        values="FirstName='$first_name' LastName='$last_name' AccountId=$account_id Email=$email Phone=$phone MobilePhone=$phone QuoteWake_Call_Locale__c='$CALL_LOCALE'"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Contact --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_primary_contact_role() {
    local opportunity_id="$1" contact_id="$2" existing_id
    existing_id="$(query_id "SELECT Id FROM OpportunityContactRole WHERE OpportunityId = '$opportunity_id' AND ContactId = '$contact_id' LIMIT 1")"
    if [[ -n "$existing_id" ]]; then
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject OpportunityContactRole --record-id "$existing_id" --values "IsPrimary=true Role='Decision Maker'" >/dev/null
    else
        create_msg "OpportunityContactRole: $opportunity_id -> $contact_id"
        sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject OpportunityContactRole --values "OpportunityId=$opportunity_id ContactId=$contact_id IsPrimary=true Role='Decision Maker'" >/dev/null
    fi
}

demo_quote_ids() {
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --query "SELECT Id FROM Quote WHERE Name LIKE '${DEMO_QUOTE_PREFIX}%'" \
        --json | jq -r '.result.records[]?.Id // empty'
}

reset_demo_data() {
    local quote_ids quote_id task_id quote_task_ids deleted_tasks reset_quotes
    [[ -n "$RESET_GENERATION_AT" ]] || fail "Reset generation marker was not initialized."
    quote_ids="$(demo_quote_ids)"
    [[ -n "$quote_ids" ]] || fail "No demo Quotes were found after seeding; reset stopped without deleting Tasks."

    info "Deleting Tasks linked to QuoteWake demo Quotes only..."
    deleted_tasks=0
    while IFS= read -r quote_id; do
        [[ -z "$quote_id" ]] && continue
        # Query each Quote explicitly because WhatId is polymorphic; this keeps
        # the delete scope limited to Tasks whose WhatId is a demo Quote.
        quote_task_ids="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
            --query "SELECT Id FROM Task WHERE WhatId = '$quote_id'" \
            --json | jq -r '.result.records[]?.Id // empty')"
        while IFS= read -r task_id; do
            [[ -z "$task_id" ]] && continue
            sf data delete record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Task --record-id "$task_id" >/dev/null
            deleted_tasks=$((deleted_tasks + 1))
        done <<<"$quote_task_ids"
    done <<<"$quote_ids"
    ok "Deleted $deleted_tasks Task(s) linked to demo Quotes"

    info "Resetting QuoteWake state on demo Quotes..."
    reset_quotes=0
    while IFS= read -r quote_id; do
        [[ -z "$quote_id" ]] && continue
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
            --sobject Quote \
            --record-id "$quote_id" \
            --values "QuoteWake_Enabled__c=true Follow_Up_Status__c= Next_Follow_Up_At__c=$RESET_GENERATION_AT Attempt_Count__c=0" \
            >/dev/null
        reset_quotes=$((reset_quotes + 1))
    done <<<"$quote_ids"
    ok "Reset QuoteWake state on $reset_quotes demo Quote(s) (generation $RESET_GENERATION_AT)"
}

if [[ "$SEED_DATA" == true ]]; then
    if ((${#TEST_PHONES[@]} == 1)); then
        info "Using one configured test phone for all demo Contacts."
    elif ((${#TEST_PHONES[@]} > 1)); then
        info "Assigning ${#TEST_PHONES[@]} configured test phones randomly across demo Contacts."
    fi
    info "Inspecting required standard fields before seeding demo data..."
    check_required_fields Account "Name Phone BillingCountryCode"
    check_required_fields Contact "FirstName LastName AccountId Email Phone"
    check_required_fields Opportunity "Name AccountId StageName CloseDate Amount"
    check_required_fields OpportunityContactRole "OpportunityId ContactId IsPrimary Role"
    check_required_fields Quote "Name OpportunityId Pricebook2Id ExpirationDate"
    check_required_fields Product2 "Name"
    check_required_fields PricebookEntry "Pricebook2Id Product2Id UnitPrice"
    check_required_fields QuoteLineItem "QuoteId PricebookEntryId Quantity Product2Id UnitPrice"

    PRICEBOOK_ID="$(query_id "SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1")"
    [[ -n "$PRICEBOOK_ID" ]] || fail "No standard Price Book was found. Create or activate the standard Price Book in Setup, then retry."
    PRICEBOOK_ACTIVE="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT IsActive FROM Pricebook2 WHERE Id = '$PRICEBOOK_ID'" --json | jq -r '.result.records[0].IsActive')"
    if [[ "$PRICEBOOK_ACTIVE" != "true" ]]; then
        info "Activating the standard Price Book discovered in this org..."
        sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Pricebook2 --record-id "$PRICEBOOK_ID" --values "IsActive=true" >/dev/null
    fi

    PRODUCT_LABOR="$(ensure_product QW-LABOR "QuoteWake Demo - Electrical Installation Labor" "Fictional demo labor line for electrical installation work.")"
    PRODUCT_MATERIALS="$(ensure_product QW-MATERIALS "QuoteWake Demo - Electrical Materials" "Fictional demo materials line for electrical projects.")"
    PRODUCT_CHARGER="$(ensure_product QW-EV-CHARGER "QuoteWake Demo - EV Charger" "Fictional demo EV charger hardware line.")"
    PRODUCT_CABLING="$(ensure_product QW-CABLING "QuoteWake Demo - Office Cabling" "Fictional demo office cabling line.")"
    PRODUCT_SOLAR="$(ensure_product QW-SOLAR-WIRING "QuoteWake Demo - Solar Wiring" "Fictional demo solar panel wiring line.")"

    PBE_LABOR="$(ensure_pricebook_entry "$PRODUCT_LABOR" 150)"
    PBE_MATERIALS="$(ensure_pricebook_entry "$PRODUCT_MATERIALS" 1550)"
    PBE_CHARGER="$(ensure_pricebook_entry "$PRODUCT_CHARGER" 1100)"
    PBE_CABLING="$(ensure_pricebook_entry "$PRODUCT_CABLING" 120)"
    PBE_SOLAR="$(ensure_pricebook_entry "$PRODUCT_SOLAR" 2000)"

    TODAY="$(utc_date_value today)"
    QUOTE_EXPIRATION_DATE="$(utc_date_value add-months 3)"

    info "Creating or updating QuoteWake demo hierarchy..."
    ACCOUNT_1="$(ensure_record Account 'QuoteWake Demo - Instalaciones Sol y Mar S.L.' "Name='QuoteWake Demo - Instalaciones Sol y Mar S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_2="$(ensure_record Account 'QuoteWake Demo - Cargas Eléctricas del Norte S.L.' "Name='QuoteWake Demo - Cargas Eléctricas del Norte S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_3="$(ensure_record Account 'QuoteWake Demo - Oficinas Iberia S.L.' "Name='QuoteWake Demo - Oficinas Iberia S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_4="$(ensure_record Account 'QuoteWake Demo - Energía Clara S.L.' "Name='QuoteWake Demo - Energía Clara S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_5="$(ensure_record Account 'QuoteWake Demo - Alba Domótica S.L.' "Name='QuoteWake Demo - Alba Domótica S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_6="$(ensure_record Account 'QuoteWake Demo - Clima y Luz Levante S.L.' "Name='QuoteWake Demo - Clima y Luz Levante S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_7="$(ensure_record Account 'QuoteWake Demo - Talleres Costa Verde S.L.' "Name='QuoteWake Demo - Talleres Costa Verde S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_8="$(ensure_record Account 'QuoteWake Demo - Servicios Norte Claro S.L.' "Name='QuoteWake Demo - Servicios Norte Claro S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"
    ACCOUNT_9="$(ensure_record Account 'QuoteWake Demo - Construcciones Lumen S.L.' "Name='QuoteWake Demo - Construcciones Lumen S.L.' Phone=+14155550100 BillingCountryCode=$COUNTRY_CODE")"

    CONTACT_1="$(ensure_contact "$ACCOUNT_1" Marta García marta.garcia.quotewake@example.invalid "$(test_phone_for_contact +14155550121)")"
    CONTACT_2="$(ensure_contact "$ACCOUNT_2" Javier López javier.lopez.quotewake@example.invalid "$(test_phone_for_contact +14155550122)")"
    CONTACT_3="$(ensure_contact "$ACCOUNT_3" Lucía Martín lucia.martin.quotewake@example.invalid "$(test_phone_for_contact +14155550123)")"
    CONTACT_4="$(ensure_contact "$ACCOUNT_4" Diego Navarro diego.navarro.quotewake@example.invalid "$(test_phone_for_contact +14155550124)")"
    CONTACT_5="$(ensure_contact "$ACCOUNT_5" Ana Romero ana.romero.quotewake@example.invalid "$(test_phone_for_contact +14155550125)")"
    CONTACT_6="$(ensure_contact "$ACCOUNT_6" Pablo Sanz pablo.sanz.quotewake@example.invalid "$(test_phone_for_contact +14155550126)")"
    CONTACT_7="$(ensure_contact "$ACCOUNT_7" Elena Vidal elena.vidal.quotewake@example.invalid "$(test_phone_for_contact +14155550127)")"
    CONTACT_8="$(ensure_contact "$ACCOUNT_8" Sergio Moya sergio.moya.quotewake@example.invalid "$(test_phone_for_contact +14155550128)")"
    CONTACT_9="$(ensure_contact "$ACCOUNT_9" Nora Gil nora.gil.quotewake@example.invalid "$(test_phone_for_contact +14155550129)")"
    # The second opportunity under ACCOUNT_1 deliberately has its own contact
    # so both primary OpportunityContactRole records are independently testable.
    CONTACT_10="$(ensure_contact "$ACCOUNT_1" Tomás Ríos tomas.rios.quotewake@example.invalid "$(test_phone_for_contact +14155550130)")"
    : "$CONTACT_1" "$CONTACT_2" "$CONTACT_3" "$CONTACT_4" "$CONTACT_5" "$CONTACT_6" "$CONTACT_7" "$CONTACT_8" "$CONTACT_9" "$CONTACT_10"

    OPPORTUNITY_1="$(ensure_record Opportunity 'QuoteWake Demo - Reforma eléctrica cocina' "Name='QuoteWake Demo - Reforma eléctrica cocina' AccountId=$ACCOUNT_1 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=4250")"
    OPPORTUNITY_2="$(ensure_record Opportunity 'QuoteWake Demo - Instalación cargador EV' "Name='QuoteWake Demo - Instalación cargador EV' AccountId=$ACCOUNT_2 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=1650")"
    OPPORTUNITY_3="$(ensure_record Opportunity 'QuoteWake Demo - Mejora eléctrica oficina' "Name='QuoteWake Demo - Mejora eléctrica oficina' AccountId=$ACCOUNT_3 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=8900")"
    OPPORTUNITY_4="$(ensure_record Opportunity 'QuoteWake Demo - Cableado paneles solares' "Name='QuoteWake Demo - Cableado paneles solares' AccountId=$ACCOUNT_4 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=3200")"
    OPPORTUNITY_5="$(ensure_record Opportunity 'QuoteWake Demo - Reforma iluminación inteligente' "Name='QuoteWake Demo - Reforma iluminación inteligente' AccountId=$ACCOUNT_5 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=4700")"
    OPPORTUNITY_6="$(ensure_record Opportunity 'QuoteWake Demo - Auditoría energética edificio' "Name='QuoteWake Demo - Auditoría energética edificio' AccountId=$ACCOUNT_6 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=2800")"
    OPPORTUNITY_7="$(ensure_record Opportunity 'QuoteWake Demo - Mejora seguridad taller' "Name='QuoteWake Demo - Mejora seguridad taller' AccountId=$ACCOUNT_7 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=6150")"
    OPPORTUNITY_8="$(ensure_record Opportunity 'QuoteWake Demo - Cuadro eléctrico comercio' "Name='QuoteWake Demo - Cuadro eléctrico comercio' AccountId=$ACCOUNT_8 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=7350")"
    OPPORTUNITY_9="$(ensure_record Opportunity 'QuoteWake Demo - Monitorización solar vivienda' "Name='QuoteWake Demo - Monitorización solar vivienda' AccountId=$ACCOUNT_9 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=5200")"
    OPPORTUNITY_10="$(ensure_record Opportunity 'QuoteWake Demo - Mantenimiento eléctrico cocina' "Name='QuoteWake Demo - Mantenimiento eléctrico cocina' AccountId=$ACCOUNT_1 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=1800")"

    ensure_primary_contact_role "$OPPORTUNITY_1" "$CONTACT_1"
    ensure_primary_contact_role "$OPPORTUNITY_2" "$CONTACT_2"
    ensure_primary_contact_role "$OPPORTUNITY_3" "$CONTACT_3"
    ensure_primary_contact_role "$OPPORTUNITY_4" "$CONTACT_4"
    ensure_primary_contact_role "$OPPORTUNITY_5" "$CONTACT_5"
    ensure_primary_contact_role "$OPPORTUNITY_6" "$CONTACT_6"
    ensure_primary_contact_role "$OPPORTUNITY_7" "$CONTACT_7"
    ensure_primary_contact_role "$OPPORTUNITY_8" "$CONTACT_8"
    ensure_primary_contact_role "$OPPORTUNITY_9" "$CONTACT_9"
    ensure_primary_contact_role "$OPPORTUNITY_10" "$CONTACT_10"

    ensure_quote() {
        local name="$1" opportunity_id="$2" quote_status="$3"
        local existing_id structural_values create_values
        existing_id="$(query_id "SELECT Id FROM Quote WHERE Name = '$name' LIMIT 1")"
        structural_values="Name='$name' OpportunityId=$opportunity_id Pricebook2Id=$PRICEBOOK_ID ExpirationDate=$QUOTE_EXPIRATION_DATE Status='$quote_status'"
        create_values="$structural_values QuoteWake_Enabled__c=true Attempt_Count__c=0"
        if [[ -n "$existing_id" ]]; then
            # A normal seed repairs the demo hierarchy without erasing call
            # progress. Use --reset-data when a clean QuoteWake state is wanted.
            sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --record-id "$existing_id" --values "$structural_values" >/dev/null
            printf '%s\n' "$existing_id"
        else
            create_msg "Quote: $name"
            sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --values "$create_values" --json | jq -r '.result.id'
        fi
    }

    QUOTE_1="$(ensure_quote 'QuoteWake Demo - Kitchen Electrical Renovation' "$OPPORTUNITY_1" Presented)"
    QUOTE_2="$(ensure_quote 'QuoteWake Demo - EV Charger Installation' "$OPPORTUNITY_2" Presented)"
    QUOTE_3="$(ensure_quote 'QuoteWake Demo - Office Electrical Upgrade' "$OPPORTUNITY_3" Presented)"
    QUOTE_4="$(ensure_quote 'QuoteWake Demo - Solar Panel Wiring' "$OPPORTUNITY_4" Presented)"
    QUOTE_5="$(ensure_quote 'QuoteWake Demo - Smart Lighting Retrofit' "$OPPORTUNITY_5" Presented)"
    QUOTE_6="$(ensure_quote 'QuoteWake Demo - Building Energy Audit' "$OPPORTUNITY_6" Presented)"
    QUOTE_7="$(ensure_quote 'QuoteWake Demo - Workshop Safety Upgrade' "$OPPORTUNITY_7" Presented)"
    QUOTE_8="$(ensure_quote 'QuoteWake Demo - Retail Panel Upgrade' "$OPPORTUNITY_8" Presented)"
    QUOTE_9="$(ensure_quote 'QuoteWake Demo - Villa Solar Monitoring' "$OPPORTUNITY_9" Presented)"
    QUOTE_10="$(ensure_quote 'QuoteWake Demo - Kitchen Maintenance Contract' "$OPPORTUNITY_10" Presented)"

    ensure_quote_line "$QUOTE_1" "$PRODUCT_LABOR" "$PBE_LABOR" 18 150 "Electrical installation labor (18 hours)"
    ensure_quote_line "$QUOTE_1" "$PRODUCT_MATERIALS" "$PBE_MATERIALS" 1 1550 "Kitchen renovation materials and fittings"
    ensure_quote_line "$QUOTE_2" "$PRODUCT_CHARGER" "$PBE_CHARGER" 1 1100 "22 kW EV charger supply"
    ensure_quote_line "$QUOTE_2" "$PRODUCT_LABOR" "$PBE_LABOR" 1 550 "EV charger installation and commissioning"
    ensure_quote_line "$QUOTE_3" "$PRODUCT_CABLING" "$PBE_CABLING" 25 120 "Office low-voltage cabling (25 meters)"
    ensure_quote_line "$QUOTE_3" "$PRODUCT_LABOR" "$PBE_LABOR" 40 147.5 "Office electrical upgrade labor (40 hours)"
    ensure_quote_line "$QUOTE_4" "$PRODUCT_SOLAR" "$PBE_SOLAR" 1 2000 "Solar panel wiring materials"
    ensure_quote_line "$QUOTE_4" "$PRODUCT_LABOR" "$PBE_LABOR" 1 1200 "Solar wiring installation labor"
    ensure_quote_line "$QUOTE_5" "$PRODUCT_LABOR" "$PBE_LABOR" 12 150 "Smart lighting installation labor (12 hours)"
    ensure_quote_line "$QUOTE_5" "$PRODUCT_MATERIALS" "$PBE_MATERIALS" 1 2900 "Smart lighting controls and fittings"
    ensure_quote_line "$QUOTE_6" "$PRODUCT_SOLAR" "$PBE_SOLAR" 1 2000 "Building energy audit instrumentation"
    ensure_quote_line "$QUOTE_6" "$PRODUCT_LABOR" "$PBE_LABOR" 4 200 "Energy audit engineering work (4 hours)"
    ensure_quote_line "$QUOTE_7" "$PRODUCT_LABOR" "$PBE_LABOR" 24 150 "Workshop safety upgrade labor (24 hours)"
    ensure_quote_line "$QUOTE_7" "$PRODUCT_MATERIALS" "$PBE_MATERIALS" 1 2550 "Workshop protection and safety materials"
    ensure_quote_line "$QUOTE_8" "$PRODUCT_MATERIALS" "$PBE_MATERIALS" 2 1550 "Retail distribution panel materials"
    ensure_quote_line "$QUOTE_8" "$PRODUCT_LABOR" "$PBE_LABOR" 20 137.5 "Retail panel installation labor (20 hours)"
    ensure_quote_line "$QUOTE_9" "$PRODUCT_SOLAR" "$PBE_SOLAR" 1 2000 "Solar monitoring equipment"
    ensure_quote_line "$QUOTE_9" "$PRODUCT_LABOR" "$PBE_LABOR" 16 200 "Solar monitoring installation labor (16 hours)"
    ensure_quote_line "$QUOTE_10" "$PRODUCT_LABOR" "$PBE_LABOR" 8 150 "Kitchen maintenance labor (8 hours)"
    ok "Demo hierarchy is ready: 9 Accounts, 10 Opportunities and 10 Quotes"
fi

if [[ "$RESET_DATA" == true ]]; then
    # Keep one UTC generation marker for all demo Quotes in this reset. The
    # millisecond precision makes consecutive resets produce different
    # retry-marker values while remaining a Salesforce DateTime value.
    RESET_GENERATION_AT="$(utc_date_value reset-marker)"
    reset_demo_data
fi

info "Verifying QuoteWake fields and querying Quotes..."
sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id, Name, OpportunityId, Status, Subtotal, GrandTotal, LastModifiedDate, ExpirationDate, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c FROM Quote ORDER BY CreatedDate DESC" --result-format human
if [[ "$RESET_DATA" == true ]]; then
    printf '[VERIFY] Reset generation marker (UTC): %s; Follow_Up_Status__c remains blank so the initial READY branch is eligible.\n' "$RESET_GENERATION_AT"
fi
if [[ "$SEED_DATA" == true ]]; then
    printf '[VERIFY] Demo Account country and Contact CALL-E locale (phone values omitted):\n'
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id, Name, BillingCountryCode FROM Account WHERE Name LIKE 'QuoteWake Demo - %' ORDER BY Name" --result-format human
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Id, Name, Account.Name FROM Opportunity WHERE Name LIKE 'QuoteWake Demo - %' ORDER BY Account.Name, Name" --result-format human
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Opportunity.Name, Contact.Name, Contact.QuoteWake_Call_Locale__c, IsPrimary FROM OpportunityContactRole WHERE Opportunity.Name LIKE 'QuoteWake Demo - %' ORDER BY Opportunity.Name" --result-format human
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "SELECT Quote.Name, Product2.Name, Description, Quantity, UnitPrice, TotalPrice FROM QuoteLineItem WHERE Quote.Name LIKE 'QuoteWake Demo - %' ORDER BY Quote.Name, Product2.Name" --result-format human
fi
printf '\n[VERIFY] Actionable QuoteWake SOQL (MAX_ATTEMPTS=%s from follow-up policy):\n' "$MAX_ATTEMPTS"
ELIGIBILITY_DATES="$(utc_date_value eligibility "$STANDARD_DELAY_SECONDS" "$MINIMUM_DELAY_SECONDS" "$DUE_SOON_SECONDS")"
QUERY_NOW="$(jq -r '.query_now' <<<"$ELIGIBILITY_DATES")"
INITIAL_STANDARD_CUTOFF="$(jq -r '.standard_cutoff' <<<"$ELIGIBILITY_DATES")"
INITIAL_MINIMUM_CUTOFF="$(jq -r '.minimum_cutoff' <<<"$ELIGIBILITY_DATES")"
DUE_SOON_DATE="$(jq -r '.due_soon_date' <<<"$ELIGIBILITY_DATES")"
TODAY="$(jq -r '.today' <<<"$ELIGIBILITY_DATES")"
printf '%s\n' "SELECT Id, Name, OpportunityId, LastModifiedDate, ExpirationDate, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c FROM Quote WHERE QuoteWake_Enabled__c = true AND Status = 'Presented' AND Opportunity.IsClosed = false AND (ExpirationDate = null OR ExpirationDate >= $TODAY) AND (Attempt_Count__c = null OR Attempt_Count__c < $MAX_ATTEMPTS) AND ((Follow_Up_Status__c = null AND (LastModifiedDate <= $INITIAL_STANDARD_CUTOFF OR (LastModifiedDate <= $INITIAL_MINIMUM_CUTOFF AND ExpirationDate != null AND ExpirationDate <= $DUE_SOON_DATE))) OR (Follow_Up_Status__c = 'Retry' AND Next_Follow_Up_At__c != null AND Next_Follow_Up_At__c <= $QUERY_NOW)) ORDER BY Next_Follow_Up_At__c ASC NULLS FIRST, LastModifiedDate ASC"

ok "QuoteWake Salesforce MVP setup finished"
