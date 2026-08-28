#!/usr/bin/env bash

# Provision the least-privilege Salesforce runtime identity used by QuoteWake.
#
# The script deliberately keeps authentication inside the Salesforce CLI.  In
# particular, it never asks for, generates, prints, or stores a password.  The
# REST password DELETE endpoint asks Salesforce to send the normal reset email.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SALESFORCE_DIR="$APP_DIR/salesforce"
PERMISSION_SET="QuoteWake_User"
PROFILE_NAME="QuoteWake Runtime"
TARGET_ORG=""
RUNTIME_EMAIL=""
RUNTIME_USERNAME=""
DRY_RUN=false
RESEND_WELCOME=false
ORG_API_VERSION="66.0"
PROFILE_ID=""
USER_LICENSE_NAME=""
USER_LICENSE_AVAILABLE=""
ORG_TYPE=""
ORG_TIMEZONE=""
ORG_LOCALE=""
ORG_LANGUAGE=""
USER_ID=""
USER_EXISTS=false
USER_CREATED=false
USER_ACTIVE=false
PERMISSION_ASSIGNED=false

info() { printf '[INFO] %s\n' "$1"; }
ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1" >&2; }
fail() { printf '[ERROR] %s\n' "$1" >&2; exit 1; }

usage() {
    cat <<'EOF'
Create or reconcile the dedicated QuoteWake runtime Salesforce user.

The command must be run with an administrator-authenticated Salesforce CLI
target. It validates the org, profile, Salesforce license, schema, metadata,
username, and existing-user conflicts before making any change. The first run
deploys QuoteWake_User, creates (or reuses) the user, assigns the set, and
asks Salesforce to send a password-reset/welcome email. Passwords are never
printed or stored by this script.

Usage:
  ./scripts/create-user.sh --target-org ALIAS --email EMAIL --username USERNAME

Options:
  --target-org ALIAS_OR_USERNAME  Administrator-authenticated Salesforce target (required).
  --email EMAIL                   QuoteWake runtime user's email address (required).
  --username USERNAME             Globally unique Salesforce username (required).
  --dry-run                       Run all read-only checks and metadata validation, but do not mutate.
  --resend-welcome                Reset the existing user's password and send another Salesforce email.
  -h, --help                     Show this help.

Examples:
  ./scripts/create-user.sh --target-org quotewake-dev \
    --email quotewake.runtime@example.com --username quotewake.runtime@example.com
  ./scripts/create-user.sh --target-org quotewake-dev \
    --email quotewake.runtime@example.com --username quotewake.runtime@example.com --dry-run
EOF
}

require_value() {
    (($# >= 2)) || fail "$1 requires a value."
    [[ -n "$2" && "$2" != -* ]] || fail "$1 requires a non-empty value."
}

validate_email() {
    local value="$1"
    # Keep values passed to sf's shell-style --values parser deliberately
    # narrow. Salesforce also requires a dot in a normal internet username.
    [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,63}$ ]] || \
        fail "Invalid email '$value'. Use a normal address such as quotewake.runtime@example.com."
    [[ "$value" != *"'"* && "$value" != *'\\'* ]] || \
        fail "Email and username must not contain quotes or backslashes."
}

validate_username() {
    local value="$1"
    [[ ${#value} -le 80 ]] || fail "Salesforce username must be at most 80 characters."
    validate_email "$value"
}

parse_args() {
    while (($# > 0)); do
        case "$1" in
            --target-org)
                require_value "$@"
                [[ -z "$TARGET_ORG" ]] || fail "Option --target-org may only be supplied once."
                TARGET_ORG="$2"
                shift 2
                ;;
            --email)
                require_value "$@"
                [[ -z "$RUNTIME_EMAIL" ]] || fail "Option --email may only be supplied once."
                RUNTIME_EMAIL="$2"
                shift 2
                ;;
            --username)
                require_value "$@"
                [[ -z "$RUNTIME_USERNAME" ]] || fail "Option --username may only be supplied once."
                RUNTIME_USERNAME="$2"
                shift 2
                ;;
            --dry-run)
                [[ "$DRY_RUN" == false ]] || fail "Option --dry-run may only be supplied once."
                DRY_RUN=true
                shift
                ;;
            --resend-welcome)
                [[ "$RESEND_WELCOME" == false ]] || fail "Option --resend-welcome may only be supplied once."
                RESEND_WELCOME=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            --*|-*)
                fail "Unknown option '$1'. Use --help for usage."
                ;;
            *)
                fail "Unexpected argument '$1'. Use --help for usage."
                ;;
        esac
    done

    [[ -n "$TARGET_ORG" ]] || fail "--target-org is required."
    [[ -n "$RUNTIME_EMAIL" ]] || fail "--email is required."
    [[ -n "$RUNTIME_USERNAME" ]] || fail "--username is required."
    validate_email "$RUNTIME_EMAIL"
    validate_username "$RUNTIME_USERNAME"
    ORG_ARGS=(--target-org "$TARGET_ORG")
}

require_commands() {
    command -v sf >/dev/null 2>&1 || fail "Salesforce CLI (sf) is not installed or is not on PATH."
    command -v jq >/dev/null 2>&1 || fail "jq is required to inspect Salesforce CLI JSON responses."
}

ORG_ARGS=()

# Capture JSON so Salesforce CLI diagnostics (which can include instance
# details) never get mixed into our intentionally bounded output.
sf_json() {
    local output
    if ! output="$(sf "$@" --json 2>/dev/null)"; then
        return 1
    fi
    printf '%s\n' "$output"
}

soql_json() {
    local query="$1"
    local response
    response="$(sf_json data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$query")" || return 1
    jq -e '.status == 0 and (.result | type == "object")' <<<"$response" >/dev/null || return 1
    printf '%s\n' "$response"
}

query_one_json() {
    local query="$1"
    local response
    response="$(soql_json "$query")" || return 1
    # A valid query can have no records (for example, an empty demo org). Keep
    # that a successful, empty object so schema checks can still inspect the
    # query response and required-record checks can fail with a useful message.
    jq -ce 'select(.status == 0 and (.result.records | type == "array")) | .result.records[0] // {}' <<<"$response"
}

preflight_org() {
    local display organization is_scratch

    display="$(sf_json org display ${ORG_ARGS[@]+"${ORG_ARGS[@]}"})" || \
        fail "Salesforce CLI is not authenticated for target '$TARGET_ORG'."
    if [[ "$(jq -r '.status // 0' <<<"$display")" != "0" ]]; then
        fail "Salesforce CLI could not validate target '$TARGET_ORG'."
    fi
    is_scratch="$(jq -r '.result.isScratch // false' <<<"$display")"
    [[ "$is_scratch" != true ]] || fail "Scratch orgs are not supported for runtime-user provisioning."

    organization="$(query_one_json "SELECT OrganizationType, IsSandbox, TimeZoneSidKey, DefaultLocaleSidKey, LanguageLocaleKey FROM Organization LIMIT 1")" || \
        fail "Could not read Salesforce Organization settings from target '$TARGET_ORG'."
    ORG_TYPE="$(jq -r '.OrganizationType // empty' <<<"$organization")"
    ORG_TIMEZONE="$(jq -r '.TimeZoneSidKey // empty' <<<"$organization")"
    ORG_LOCALE="$(jq -r '.DefaultLocaleSidKey // empty' <<<"$organization")"
    ORG_LANGUAGE="$(jq -r '.LanguageLocaleKey // empty' <<<"$organization")"
    local is_sandbox
    is_sandbox="$(jq -r '.IsSandbox // false' <<<"$organization")"
    [[ "$ORG_TYPE" == 'Developer Edition' || "$is_sandbox" == true ]] || \
        fail "Target org type '$ORG_TYPE' is not supported. Use a Developer Edition or sandbox."
    [[ -n "$ORG_TIMEZONE" && -n "$ORG_LOCALE" ]] || \
        fail "Salesforce Organization did not return timezone and locale settings."
    [[ -n "$ORG_LANGUAGE" ]] || ORG_LANGUAGE="$ORG_LOCALE"
    info "Validated non-production org type: $ORG_TYPE"
}

preflight_profile_and_license() {
    local profile license total used

    profile="$(query_one_json "SELECT Id, Name, PermissionsApiEnabled, UserLicense.Name FROM Profile WHERE Name = '$PROFILE_NAME' LIMIT 1")" || \
        fail "Profile '$PROFILE_NAME' was not found in the target org."
    PROFILE_ID="$(jq -r '.Id // empty' <<<"$profile")"
    USER_LICENSE_NAME="$(jq -r '.UserLicense.Name // empty' <<<"$profile")"
    [[ -n "$PROFILE_ID" ]] || fail "Profile '$PROFILE_NAME' has no Salesforce ID."
    [[ "$USER_LICENSE_NAME" == Salesforce ]] || \
        fail "Profile '$PROFILE_NAME' uses '$USER_LICENSE_NAME', not the Salesforce license."

    license="$(query_one_json "SELECT Name, TotalLicenses, UsedLicenses, Status FROM UserLicense WHERE Name = 'Salesforce' LIMIT 1")" || \
        fail "Salesforce user license was not found in the target org."
    total="$(jq -r '.TotalLicenses // 0' <<<"$license")"
    used="$(jq -r '.UsedLicenses // 0' <<<"$license")"
    [[ "$total" =~ ^[0-9]+$ && "$used" =~ ^[0-9]+$ ]] || \
        fail "Salesforce license counts were malformed."
    USER_LICENSE_AVAILABLE="$((total - used))"
    info "Validated $PROFILE_NAME profile and Salesforce license counts ($USER_LICENSE_AVAILABLE available)."
}

require_available_license() {
    if [[ "$USER_EXISTS" != true || "$USER_ACTIVE" != true ]]; then
        (( USER_LICENSE_AVAILABLE > 0 )) || \
            fail "No Salesforce user license is available to create or reactivate the QuoteWake runtime user."
    fi
}

preflight_schema() {
    local record

    [[ -f "$SALESFORCE_DIR/force-app/main/default/permissionsets/$PERMISSION_SET.permissionset-meta.xml" ]] || \
        fail "Permission set metadata is missing from the local Salesforce project."

    # These read-only queries verify that Quotes are enabled and that every
    # QuoteWake field used by the application exists before any deployment or
    # user write is attempted.
    record="$(query_one_json "SELECT Id, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c FROM Quote LIMIT 1")" || \
        fail "Quote or its QuoteWake fields are unavailable. Enable Quotes and deploy QuoteWake metadata first."
    [[ -n "$record" ]] || fail "Salesforce did not return a usable Quote schema response."
    query_one_json "SELECT Id, QuoteWake_Call_Locale__c, Email, Phone, MobilePhone FROM Contact LIMIT 1" >/dev/null || \
        fail "Contact or QuoteWake_Call_Locale__c is unavailable. Deploy QuoteWake metadata first."
    query_one_json "SELECT Id, Name FROM Account LIMIT 1" >/dev/null || \
        fail "Account is unavailable in the target org."
    query_one_json "SELECT Id, Name FROM Opportunity LIMIT 1" >/dev/null || \
        fail "Opportunity is unavailable in the target org."
    query_one_json "SELECT Id, QuoteId, Product2Id, Quantity, UnitPrice, TotalPrice, Description FROM QuoteLineItem LIMIT 1" >/dev/null || \
        fail "QuoteLineItem or its commercial fields are unavailable in the target org."
    query_one_json "SELECT Id, Name, QuantityUnitOfMeasure FROM Product2 LIMIT 1" >/dev/null || \
        fail "Product2 or its product fields are unavailable in the target org."
    query_one_json "SELECT Id, OpportunityId, ContactId, IsPrimary FROM OpportunityContactRole LIMIT 1" >/dev/null || \
        fail "OpportunityContactRole or its relationship fields are unavailable in the target org."
    # Task has no Name field; Subject is its human-readable identifier.
    query_one_json "SELECT Id, Subject FROM Task LIMIT 1" >/dev/null || \
        fail "Task is unavailable in the target org."
    info "Validated QuoteWake schema and standard objects."
}

preflight_metadata() {
    info "Validating QuoteWake user permissions and Salesforce UI metadata without saving it to Salesforce..."
    if ! (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --source-dir "force-app/main/default/permissionsets/$PERMISSION_SET.permissionset-meta.xml" \
        --source-dir force-app/main/default/objects/Contact \
        --source-dir "force-app/main/default/profiles/$PROFILE_NAME.profile-meta.xml" \
        --dry-run --wait 30 --concise >/dev/null 2>&1); then
        fail "Salesforce rejected the QuoteWake user permissions or UI metadata during dry-run validation. No changes were made."
    fi
    ok "QuoteWake user permissions and UI metadata passed Salesforce dry-run validation."
}

find_existing_user() {
    local response count record username email profile_name license_name
    response="$(soql_json "SELECT Id, Username, Email, IsActive, ProfileId, Profile.Name, Profile.UserLicense.Name FROM User WHERE Username = '$RUNTIME_USERNAME' OR Email = '$RUNTIME_EMAIL' LIMIT 10")" || \
        fail "Could not inspect existing Salesforce users before provisioning."
    count="$(jq -r '.result.totalSize // 0' <<<"$response")"
    [[ "$count" =~ ^[0-9]+$ ]] || fail "Salesforce returned an invalid user query response."
    (( count <= 1 )) || fail "More than one Salesforce user matched the requested username/email; refusing to guess."
    (( count == 0 )) && return 0

    record="$(jq -ce '.result.records[0]' <<<"$response")" || fail "Salesforce returned a malformed existing-user record."
    USER_ID="$(jq -r '.Id // empty' <<<"$record")"
    username="$(jq -r '.Username // empty' <<<"$record")"
    email="$(jq -r '.Email // empty' <<<"$record")"
    profile_name="$(jq -r '.Profile.Name // empty' <<<"$record")"
    license_name="$(jq -r '.Profile.UserLicense.Name // empty' <<<"$record")"
    USER_ACTIVE="$(jq -r '.IsActive // false' <<<"$record")"
    [[ "$username" == "$RUNTIME_USERNAME" ]] || \
        fail "Email '$RUNTIME_EMAIL' already belongs to another Salesforce username."
    [[ "$email" == "$RUNTIME_EMAIL" ]] || \
        fail "Username '$RUNTIME_USERNAME' already belongs to a different email address."
    [[ "$profile_name" == "$PROFILE_NAME" ]] || \
        fail "Existing username '$RUNTIME_USERNAME' has profile '$profile_name'; rerun setup to migrate it to '$PROFILE_NAME'."
    [[ "$license_name" == Salesforce ]] || \
        fail "Existing username '$RUNTIME_USERNAME' has license '$license_name'; refusing a license conflict."
    USER_EXISTS=true
    info "Found the matching QuoteWake runtime user; provisioning will be idempotent."
}

print_plan() {
    if [[ "$USER_EXISTS" == true ]]; then
        info "Plan: keep existing user $RUNTIME_USERNAME and reconcile its permission set."
        [[ "$USER_ACTIVE" == true ]] || info "Plan: reactivate the existing inactive user."
    else
        info "Plan: deploy permission set and create user $RUNTIME_USERNAME."
    fi
    info "Plan: assign $PERMISSION_SET and request a Salesforce password-reset/welcome email."
}

deploy_permission_set() {
    info "Deploying $PERMISSION_SET and Salesforce UI metadata..."
    if ! (cd "$SALESFORCE_DIR" && sf project deploy start ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} \
        --source-dir "force-app/main/default/permissionsets/$PERMISSION_SET.permissionset-meta.xml" \
        --source-dir force-app/main/default/objects/Contact \
        --source-dir "force-app/main/default/profiles/$PROFILE_NAME.profile-meta.xml" \
        --wait 30 --concise >/dev/null 2>&1); then
        fail "QuoteWake user permissions or UI metadata deployment failed. The Salesforce user was not changed."
    fi
    ok "Deployed $PERMISSION_SET and Salesforce UI metadata."
}

create_or_reactivate_user() {
    local response values
    if [[ "$USER_EXISTS" == true ]]; then
        if [[ "$USER_ACTIVE" != true ]]; then
            if ! sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject User --record-id "$USER_ID" \
                --values "IsActive=true" >/dev/null 2>&1; then
                fail "Could not reactivate the existing QuoteWake runtime user."
            fi
            ok "Reactivated the existing QuoteWake runtime user."
        fi
        return 0
    fi

    values="Username='$RUNTIME_USERNAME' Email='$RUNTIME_EMAIL' LastName='QuoteWake Runtime' Alias=qwrtuser ProfileId=$PROFILE_ID IsActive=true EmailEncodingKey=UTF-8 LanguageLocaleKey=$ORG_LANGUAGE LocaleSidKey=$ORG_LOCALE TimeZoneSidKey=$ORG_TIMEZONE"
    if ! response="$(sf data create record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject User --values "$values" --json 2>/dev/null)"; then
        fail "Could not create the QuoteWake runtime Salesforce user."
    fi
    USER_ID="$(jq -r '.result.id // empty' <<<"$response")"
    [[ -n "$USER_ID" ]] || fail "Salesforce created a user but returned no user ID."
    USER_EXISTS=true
    USER_CREATED=true
    ok "Created the QuoteWake runtime Salesforce user."
}

assign_permission_set() {
    local response count
    response="$(soql_json "SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '$USER_ID' AND PermissionSet.Name = '$PERMISSION_SET' LIMIT 1")" || \
        fail "Could not inspect permission-set assignment for the QuoteWake runtime user."
    count="$(jq -r '.result.totalSize // 0' <<<"$response")"
    [[ "$count" =~ ^[0-9]+$ ]] || fail "Salesforce returned an invalid permission-set assignment response."
    if (( count == 0 )); then
        if ! sf org assign permset ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --name "$PERMISSION_SET" \
            --on-behalf-of "$RUNTIME_USERNAME" >/dev/null 2>&1; then
            fail "Could not assign $PERMISSION_SET to the QuoteWake runtime user."
        fi
        ok "Assigned $PERMISSION_SET to the QuoteWake runtime user."
    else
        info "$PERMISSION_SET is already assigned to the QuoteWake runtime user."
    fi
    PERMISSION_ASSIGNED=true
}

send_welcome_email() {
    [[ "$USER_EXISTS" == true ]] || fail "Cannot reset a user whose ID was not returned."
    # DELETE on the Salesforce REST User password resource resets the password
    # and sends the platform's password-reset email. The CLI performs the
    # authenticated request, so no access token or generated password enters
    # this process's output, arguments, or environment.
    if ! sf api request rest \
        "/services/data/v${ORG_API_VERSION}/sobjects/User/${USER_ID}/password" \
        ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --method DELETE \
        --body '{"mode":"raw","raw":""}' >/dev/null 2>&1; then
        fail "User provisioning completed, but Salesforce could not send the password-reset email. Re-run with --resend-welcome."
    fi
    ok "Requested a Salesforce password-reset/welcome email for the QuoteWake runtime user."
}

main() {
    parse_args "$@"
    require_commands
    preflight_org
    preflight_profile_and_license
    find_existing_user
    require_available_license
    preflight_schema
    preflight_metadata
    print_plan

    if [[ "$DRY_RUN" == true ]]; then
        ok "Dry run complete: no Salesforce user, permission assignment, or email was changed."
        exit 0
    fi

    deploy_permission_set
    create_or_reactivate_user
    assign_permission_set
    # A new user must receive the first welcome email. Existing users only
    # receive another one when --resend-welcome was explicitly requested.
    if [[ "$USER_CREATED" == true || "$RESEND_WELCOME" == true ]]; then
        send_welcome_email
    fi
    ok "QuoteWake runtime-user provisioning completed. Set its Salesforce password and MFA from the email."
}

main "$@"
