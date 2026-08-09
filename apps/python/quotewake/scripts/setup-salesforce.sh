#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SALESFORCE_DIR="$APP_DIR/salesforce"
TARGET_ORG=""
SEED_DATA=false
ASSIGN_PERMISSIONS=false
CHANGES_APPLIED=false

info() { printf '[INFO] %s\n' "$1"; }
ok() { printf '[OK] %s\n' "$1"; }
create_msg() { printf '[CREATE] %s\n' "$1" >&2; }
fail() { printf '[ERROR] %s\n' "$1" >&2; exit 1; }

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
Usage: ./scripts/setup-salesforce.sh [options]

Options:
  --target-org ALIAS       Salesforce CLI alias or username to modify.
  --seed-data              Create or update the four QuoteWake demo scenarios.
  --assign-permissions     Assign QuoteWake_User to the current target-org user.
  -h, --help               Show this help.
EOF
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
        --assign-permissions)
            ASSIGN_PERMISSIONS=true
            shift
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

command -v sf >/dev/null 2>&1 || fail "Salesforce CLI (sf) is not installed or is not on PATH."
command -v jq >/dev/null 2>&1 || fail "jq is required to inspect Salesforce CLI JSON responses."
[[ -d "$SALESFORCE_DIR" ]] || fail "Salesforce project directory not found: $SALESFORCE_DIR"

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
if ! ORG_JSON="$(sf org display "${ORG_ARGS[@]}" --json 2>"$ORG_ERROR_FILE")"; then
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

QUOTE_SCHEMA="$(sf sobject describe "${ORG_ARGS[@]}" --sobject Quote --json 2>/dev/null)" || \
    fail "The standard Quote object is unavailable in this org. No Salesforce changes were attempted."
[[ "$(jq -r '.result.name // empty' <<<"$QUOTE_SCHEMA")" == "Quote" ]] || \
    fail "Salesforce did not return the standard Quote object metadata."
ok "Quote object available"

info "Enabling standard Quotes through deployable QuoteSettings metadata..."
if ! (cd "$SALESFORCE_DIR" && sf project deploy start "${ORG_ARGS[@]}" --source-dir force-app/main/default/settings --wait 30 --concise); then
    printf '[ERROR] Salesforce rejected QuoteSettings deployment.\n' >&2
    printf '[ERROR] Manual step: Setup -> Quote Settings -> check Enable Quotes -> Save, then rerun this script.\n' >&2
    exit 1
fi
CHANGES_APPLIED=true
if ! sf data query "${ORG_ARGS[@]}" --query "SELECT Id FROM Quote LIMIT 1" --result-format csv >/dev/null; then
    printf '[ERROR] The Quote object is still not queryable after QuoteSettings deployment.\n' >&2
    printf '[ERROR] Manual step: Setup -> Quote Settings -> check Enable Quotes -> Save, then rerun this script.\n' >&2
    exit 1
fi
ok "Quotes are enabled"

info "Deploying QuoteWake fields and permission set..."
(cd "$SALESFORCE_DIR" && sf project deploy start "${ORG_ARGS[@]}" --source-dir force-app/main/default/objects/Quote --source-dir force-app/main/default/permissionsets --wait 30 --concise)
CHANGES_APPLIED=true
ok "QuoteWake metadata deployment completed"

if [[ "$ASSIGN_PERMISSIONS" == true ]]; then
    CURRENT_USER_ID="$(sf data query "${ORG_ARGS[@]}" --query "SELECT Id FROM User WHERE Username = '$ORG_USERNAME' LIMIT 1" --json | jq -r '.result.records[0].Id // empty')"
    [[ -n "$CURRENT_USER_ID" ]] || fail "Could not resolve the authenticated Salesforce user ID for permission assignment."
    PERMISSION_ASSIGNMENT_ID="$(sf data query "${ORG_ARGS[@]}" --query "SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '$CURRENT_USER_ID' AND PermissionSet.Name = 'QuoteWake_User' LIMIT 1" --json | jq -r '.result.records[0].Id // empty')"
    if [[ -n "$PERMISSION_ASSIGNMENT_ID" ]]; then
        ok "QuoteWake_User is already assigned"
    else
        info "Assigning QuoteWake_User to the current authenticated Salesforce user..."
        sf org assign permset "${ORG_ARGS[@]}" --name QuoteWake_User
        ok "QuoteWake_User assigned"
    fi
fi

verify_fields() {
    local schema="$1"
    local field
    local fields=(QuoteWake_Enabled__c Follow_Up_Status__c Next_Follow_Up_At__c Attempt_Count__c Last_Follow_Up_At__c Last_Follow_Up_Result__c)
    for field in "${fields[@]}"; do
        if jq -e --arg field "$field" '.result.fields[] | select(.name == $field)' <<<"$schema" >/dev/null; then
            ok "$field exists"
        else
            fail "Expected Quote field $field was not found after deployment."
        fi
    done
}

info "Verifying QuoteWake fields..."
QUOTE_SCHEMA="$(sf sobject describe "${ORG_ARGS[@]}" --sobject Quote --json)"
verify_fields "$QUOTE_SCHEMA"

required_create_fields() {
    local object="$1"
    local schema
    schema="$(sf sobject describe "${ORG_ARGS[@]}" --sobject "$object" --json)"
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
        sf data update record "${ORG_ARGS[@]}" --sobject Product2 --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "Product2: $name"
        sf data create record "${ORG_ARGS[@]}" --sobject Product2 --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_pricebook_entry() {
    local product_id="$1" unit_price="$2" existing_id values
    existing_id="$(query_id "SELECT Id FROM PricebookEntry WHERE Pricebook2Id = '$PRICEBOOK_ID' AND Product2Id = '$product_id' LIMIT 1")"
    values="Pricebook2Id=$PRICEBOOK_ID Product2Id=$product_id UnitPrice=$unit_price IsActive=true"
    if [[ -n "$existing_id" ]]; then
        sf data update record "${ORG_ARGS[@]}" --sobject PricebookEntry --record-id "$existing_id" --values "UnitPrice=$unit_price IsActive=true" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "PricebookEntry: $product_id"
        sf data create record "${ORG_ARGS[@]}" --sobject PricebookEntry --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_quote_line() {
    local quote_id="$1" product_id="$2" pricebook_entry_id="$3" quantity="$4" unit_price="$5" description="$6"
    local existing_id values
    existing_id="$(query_id "SELECT Id FROM QuoteLineItem WHERE QuoteId = '$quote_id' AND PricebookEntryId = '$pricebook_entry_id' LIMIT 1")"
    values="QuoteId=$quote_id PricebookEntryId=$pricebook_entry_id Product2Id=$product_id Quantity=$quantity UnitPrice=$unit_price Description='$description'"
    if [[ -n "$existing_id" ]]; then
        sf data update record "${ORG_ARGS[@]}" --sobject QuoteLineItem --record-id "$existing_id" --values "Quantity=$quantity UnitPrice=$unit_price Description='$description'" >/dev/null
    else
        create_msg "QuoteLineItem: $description"
        sf data create record "${ORG_ARGS[@]}" --sobject QuoteLineItem --values "$values" >/dev/null
    fi
}

query_id() {
    local query="$1"
    sf data query "${ORG_ARGS[@]}" --query "$query" --json | jq -r '.result.records[0].Id // empty'
}

ensure_record() {
    local object="$1" name="$2" values="$3" existing_id
    existing_id="$(query_id "SELECT Id FROM $object WHERE Name = '$name' LIMIT 1")"
    if [[ -n "$existing_id" ]]; then
        sf data update record "${ORG_ARGS[@]}" --sobject "$object" --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "$object: $name"
        sf data create record "${ORG_ARGS[@]}" --sobject "$object" --values "$values" --json | jq -r '.result.id'
    fi
}

ensure_contact() {
    local account_id="$1" first_name="$2" last_name="$3" email="$4" phone="$5" existing_id values
    existing_id="$(query_id "SELECT Id FROM Contact WHERE Email = '$email' LIMIT 1")"
    values="FirstName='$first_name' LastName='$last_name' AccountId=$account_id Email=$email Phone=$phone"
    if [[ -n "$existing_id" ]]; then
        sf data update record "${ORG_ARGS[@]}" --sobject Contact --record-id "$existing_id" --values "$values" >/dev/null
        printf '%s\n' "$existing_id"
    else
        create_msg "Contact: $first_name $last_name"
        sf data create record "${ORG_ARGS[@]}" --sobject Contact --values "$values" --json | jq -r '.result.id'
    fi
}

if [[ "$SEED_DATA" == true ]]; then
    info "Inspecting required standard fields before seeding demo data..."
    check_required_fields Account "Name"
    check_required_fields Contact "FirstName LastName AccountId Email Phone"
    check_required_fields Opportunity "Name AccountId StageName CloseDate Amount"
    check_required_fields Quote "Name OpportunityId Pricebook2Id ExpirationDate"
    check_required_fields Product2 "Name"
    check_required_fields PricebookEntry "Pricebook2Id Product2Id UnitPrice"
    check_required_fields QuoteLineItem "QuoteId PricebookEntryId Quantity Product2Id UnitPrice"

    PRICEBOOK_ID="$(query_id "SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1")"
    [[ -n "$PRICEBOOK_ID" ]] || fail "No standard Price Book was found. Create or activate the standard Price Book in Setup, then retry."
    PRICEBOOK_ACTIVE="$(sf data query "${ORG_ARGS[@]}" --query "SELECT IsActive FROM Pricebook2 WHERE Id = '$PRICEBOOK_ID'" --json | jq -r '.result.records[0].IsActive')"
    if [[ "$PRICEBOOK_ACTIVE" != "true" ]]; then
        info "Activating the standard Price Book discovered in this org..."
        sf data update record "${ORG_ARGS[@]}" --sobject Pricebook2 --record-id "$PRICEBOOK_ID" --values "IsActive=true" >/dev/null
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

    NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    FUTURE="$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)"
    TODAY="$(date -u +%Y-%m-%d)"

    info "Creating or updating QuoteWake demo hierarchy..."
    ACCOUNT_1="$(ensure_record Account 'QuoteWake Demo - Instalaciones Sol y Mar S.L.' "Name='QuoteWake Demo - Instalaciones Sol y Mar S.L.'")"
    ACCOUNT_2="$(ensure_record Account 'QuoteWake Demo - Cargas Eléctricas del Norte S.L.' "Name='QuoteWake Demo - Cargas Eléctricas del Norte S.L.'")"
    ACCOUNT_3="$(ensure_record Account 'QuoteWake Demo - Oficinas Iberia S.L.' "Name='QuoteWake Demo - Oficinas Iberia S.L.'")"
    ACCOUNT_4="$(ensure_record Account 'QuoteWake Demo - Energía Clara S.L.' "Name='QuoteWake Demo - Energía Clara S.L.'")"

    CONTACT_1="$(ensure_contact "$ACCOUNT_1" Marta García marta.garcia.quotewake@example.invalid +14155550101)"
    CONTACT_2="$(ensure_contact "$ACCOUNT_2" Javier López javier.lopez.quotewake@example.invalid +14155550102)"
    CONTACT_3="$(ensure_contact "$ACCOUNT_3" Lucía Martín lucia.martin.quotewake@example.invalid +14155550103)"
    CONTACT_4="$(ensure_contact "$ACCOUNT_4" Diego Navarro diego.navarro.quotewake@example.invalid +14155550104)"
    : "$CONTACT_1" "$CONTACT_2" "$CONTACT_3" "$CONTACT_4"

    OPPORTUNITY_1="$(ensure_record Opportunity 'QuoteWake Demo - Reforma eléctrica cocina' "Name='QuoteWake Demo - Reforma eléctrica cocina' AccountId=$ACCOUNT_1 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=4250")"
    OPPORTUNITY_2="$(ensure_record Opportunity 'QuoteWake Demo - Instalación cargador EV' "Name='QuoteWake Demo - Instalación cargador EV' AccountId=$ACCOUNT_2 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=1650")"
    OPPORTUNITY_3="$(ensure_record Opportunity 'QuoteWake Demo - Mejora eléctrica oficina' "Name='QuoteWake Demo - Mejora eléctrica oficina' AccountId=$ACCOUNT_3 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=8900")"
    OPPORTUNITY_4="$(ensure_record Opportunity 'QuoteWake Demo - Cableado paneles solares' "Name='QuoteWake Demo - Cableado paneles solares' AccountId=$ACCOUNT_4 StageName='Proposal/Price Quote' CloseDate=$TODAY Amount=3200")"

    ensure_quote() {
        local name="$1" opportunity_id="$2" next_at="$3" follow_up_status="$4" attempts="$5" quote_status="$6"
        local result="${7:-}" last_at="${8:-}" existing_id values
        existing_id="$(query_id "SELECT Id FROM Quote WHERE Name = '$name' LIMIT 1")"
        values="Name='$name' OpportunityId=$opportunity_id Pricebook2Id=$PRICEBOOK_ID ExpirationDate=$(date -u -d '+30 days' +%Y-%m-%d) Status='$quote_status' QuoteWake_Enabled__c=true Follow_Up_Status__c='$follow_up_status' Attempt_Count__c=$attempts"
        [[ -n "$next_at" ]] && values+=" Next_Follow_Up_At__c=$next_at"
        [[ -n "$result" ]] && values+=" Last_Follow_Up_Result__c='$result'"
        [[ -n "$last_at" ]] && values+=" Last_Follow_Up_At__c=$last_at"
        if [[ -n "$existing_id" ]]; then
            sf data update record "${ORG_ARGS[@]}" --sobject Quote --record-id "$existing_id" --values "$values" >/dev/null
            printf '%s\n' "$existing_id"
        else
            create_msg "Quote: $name"
            sf data create record "${ORG_ARGS[@]}" --sobject Quote --values "$values" --json | jq -r '.result.id'
        fi
    }

    QUOTE_1="$(ensure_quote 'QuoteWake Demo - Kitchen Electrical Renovation' "$OPPORTUNITY_1" "$NOW" Pending 0 Presented)"
    QUOTE_2="$(ensure_quote 'QuoteWake Demo - EV Charger Installation' "$OPPORTUNITY_2" "$NOW" Retry 1 Presented)"
    QUOTE_3="$(ensure_quote 'QuoteWake Demo - Office Electrical Upgrade' "$OPPORTUNITY_3" "$FUTURE" Scheduled 0 Draft)"
    QUOTE_4="$(ensure_quote 'QuoteWake Demo - Solar Panel Wiring' "$OPPORTUNITY_4" "" Completed 1 Accepted Interested "$NOW")"

    ensure_quote_line "$QUOTE_1" "$PRODUCT_LABOR" "$PBE_LABOR" 18 150 "Electrical installation labor (18 hours)"
    ensure_quote_line "$QUOTE_1" "$PRODUCT_MATERIALS" "$PBE_MATERIALS" 1 1550 "Kitchen renovation materials and fittings"
    ensure_quote_line "$QUOTE_2" "$PRODUCT_CHARGER" "$PBE_CHARGER" 1 1100 "22 kW EV charger supply"
    ensure_quote_line "$QUOTE_2" "$PRODUCT_LABOR" "$PBE_LABOR" 1 550 "EV charger installation and commissioning"
    ensure_quote_line "$QUOTE_3" "$PRODUCT_CABLING" "$PBE_CABLING" 25 120 "Office low-voltage cabling (25 meters)"
    ensure_quote_line "$QUOTE_3" "$PRODUCT_LABOR" "$PBE_LABOR" 40 147.5 "Office electrical upgrade labor (40 hours)"
    ensure_quote_line "$QUOTE_4" "$PRODUCT_SOLAR" "$PBE_SOLAR" 1 2000 "Solar panel wiring materials"
    ensure_quote_line "$QUOTE_4" "$PRODUCT_LABOR" "$PBE_LABOR" 1 1200 "Solar wiring installation labor"
    ok "Demo Account, Contact, Opportunity and Quote hierarchy is ready"
fi

info "Verifying QuoteWake fields and querying Quotes..."
sf data query "${ORG_ARGS[@]}" --query "SELECT Id, Name, OpportunityId, Status, Subtotal, GrandTotal, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c FROM Quote ORDER BY CreatedDate DESC" --result-format human
if [[ "$SEED_DATA" == true ]]; then
    sf data query "${ORG_ARGS[@]}" --query "SELECT Quote.Name, Product2.Name, Description, Quantity, UnitPrice, TotalPrice FROM QuoteLineItem WHERE Quote.Name LIKE 'QuoteWake Demo - %' ORDER BY Quote.Name, Product2.Name" --result-format human
fi
printf '\n[VERIFY] Actionable QuoteWake SOQL (MAX_ATTEMPTS remains application configuration at 3):\n'
printf '%s\n' "SELECT Id, Name, OpportunityId, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c FROM Quote WHERE QuoteWake_Enabled__c = true AND Follow_Up_Status__c IN ('Pending', 'Scheduled', 'Retry') AND Next_Follow_Up_At__c <= TODAY AND Attempt_Count__c < 3 ORDER BY Next_Follow_Up_At__c ASC"

ok "QuoteWake Salesforce MVP setup finished"
