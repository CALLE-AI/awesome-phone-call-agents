#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename -- "$0")"
TARGET_ORG=""

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [--target-org ALIAS_OR_USERNAME]

Query Salesforce Quotes with their standard status and QuoteWake follow-up fields.

Options:
  --target-org ALIAS_OR_USERNAME  Salesforce CLI target org (optional).
  -h, --help                      Show this help.

Interactive output uses less in chop-long-lines mode. Use the left/right arrow
keys to scroll wide columns horizontally; press q to quit.

Examples:
  $SCRIPT_NAME --target-org quotewake-dev
  $SCRIPT_NAME
EOF
}

fail() {
    printf '[ERROR] %s\n' "$1" >&2
    exit 2
}

while (($# > 0)); do
    case "$1" in
        --target-org)
            (($# >= 2)) || fail "--target-org requires a value."
            [[ -n "$2" ]] || fail "--target-org requires a non-empty value."
            TARGET_ORG="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown option '$1'. Use --help for usage."
            ;;
    esac
done

ORG_ARGS=()
if [[ -n "$TARGET_ORG" ]]; then
    ORG_ARGS=(--target-org "$TARGET_ORG")
fi

QUERY="SELECT Id, Name, Status, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c, ExpirationDate, LastModifiedDate, OpportunityId, Opportunity.Name, Opportunity.IsClosed FROM Quote ORDER BY Next_Follow_Up_At__c ASC NULLS FIRST, LastModifiedDate ASC"

if [[ -t 1 ]] && command -v less >/dev/null 2>&1; then
    # -S chops long rows instead of wrapping them, so the terminal can scroll
    # horizontally to the right-hand columns.
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$QUERY" --result-format human | less -S -R
else
    sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$QUERY" --result-format human
fi
