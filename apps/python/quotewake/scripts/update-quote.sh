#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename -- "$0")"

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME QUOTE_ID [options]

Update QuoteWake follow-up fields on one Salesforce Quote.

Options:
  --enabled true|false              Set QuoteWake_Enabled__c.
  --follow-up-status STATUS         Set status: In Progress, Retry, Completed, or Stopped.
  --clear-follow-up-status          Clear Follow_Up_Status__c.
  --attempt-count 0..99             Set Attempt_Count__c.
  --retry-in DURATION               Schedule a retry from the current UTC time (d/h/m/s).
  --retry-at UTC_ISO8601            Schedule a retry at a UTC timestamp.
  --clear-retry                     Clear Next_Follow_Up_At__c.
  --target-org ALIAS_OR_USERNAME    Salesforce CLI target org.
  -h, --help                        Show this help.

Examples:
  $SCRIPT_NAME 0Q0123456789ABC --enabled true --follow-up-status Retry
  $SCRIPT_NAME 0Q0123456789ABC --retry-in 1d2h30m
  $SCRIPT_NAME 0Q0123456789ABC --retry-at 2026-08-13T10:30:00+00:00
  $SCRIPT_NAME 0Q0123456789ABC --clear-follow-up-status --clear-retry
EOF
}

fail() {
    printf '[ERROR] %s\n' "$1" >&2
    exit 2
}

require_value() {
    local option="$1"
    (($# >= 2)) || fail "$option requires a value."
    [[ -n "$2" ]] || fail "$option requires a non-empty value."
}

validate_duration() {
    local value="$1"
    local part number has_positive=false
    local days hours minutes seconds

    [[ "$value" =~ ^([0-9]+d)?([0-9]+h)?([0-9]+m)?([0-9]+s)?$ ]] || \
        fail "Invalid --retry-in '$value'. Use ordered d/h/m/s components, for example 1d2h30m15s."
    [[ -n "$value" ]] || \
        fail "Invalid --retry-in '$value'. The duration must be greater than zero."

    days="${BASH_REMATCH[1]}"
    hours="${BASH_REMATCH[2]}"
    minutes="${BASH_REMATCH[3]}"
    seconds="${BASH_REMATCH[4]}"
    for part in "$days" "$hours" "$minutes" "$seconds"; do
        [[ -n "$part" ]] || continue
        number="${part%?}"
        [[ "$number" =~ ^0+$ ]] || has_positive=true
    done
    [[ "$has_positive" == true ]] || \
        fail "Invalid --retry-in '$value'. The duration must be greater than zero."
}

validate_retry_at() {
    local value="$1"
    local base normalized

    [[ "$value" =~ ^([1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(Z|\+00:00)$ ]] || \
        fail "Invalid --retry-at '$value'. Use UTC ISO 8601 with Z or +00:00."
    base="${BASH_REMATCH[1]}"

    # A round trip rejects impossible calendar dates and clock values before
    # Salesforce CLI is inspected. Python is already required by QuoteWake and
    # avoids choosing between incompatible GNU and BSD date command syntax.
    normalized="$(python3 - "$base" 2>/dev/null <<'PY'
import sys
from datetime import datetime

value = sys.argv[1]
try:
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S")
except ValueError:
    raise SystemExit(1)
print(parsed.strftime("%Y-%m-%dT%H:%M:%S"))
PY
)" || \
        fail "Invalid --retry-at '$value'. The date or time is not valid."
    [[ "$normalized" == "$base" ]] || \
        fail "Invalid --retry-at '$value'. The date or time is not valid."

    RETRY_AT_VALUE="${base}Z"
}

compute_retry_in() {
    local value="$1"

    # datetime handles large integer components without shell arithmetic
    # overflow and captures one UTC instant for the whole operation.
    RETRY_AT_VALUE="$(python3 - "$value" 2>/dev/null <<'PY'
import re
import sys
from datetime import datetime, timedelta, timezone

value = sys.argv[1]
match = re.fullmatch(r"(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", value)
if match is None or not value:
    raise SystemExit(1)

parts = [int(part or "0") for part in match.groups()]
total_seconds = (
    parts[0] * 24 * 60 * 60
    + parts[1] * 60 * 60
    + parts[2] * 60
    + parts[3]
)
if total_seconds <= 0:
    raise SystemExit(1)

now = datetime.now(timezone.utc).replace(microsecond=0)
try:
    retry_at = now + timedelta(seconds=total_seconds)
except (OverflowError, ValueError):
    raise SystemExit(1)
print(retry_at.strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)" || fail "Invalid --retry-in '$value'. The resulting UTC timestamp is out of range."
}

QUOTE_ID=""
TARGET_ORG=""
ENABLED_SET=false
ENABLED_VALUE=""
STATUS_SET=false
STATUS_VALUE=""
CLEAR_STATUS=false
ATTEMPT_SET=false
ATTEMPT_VALUE=""
RETRY_IN_SET=false
RETRY_IN_VALUE=""
RETRY_AT_SET=false
RETRY_AT_INPUT=""
CLEAR_RETRY=false

while (($# > 0)); do
    case "$1" in
        --enabled)
            require_value "$@"
            [[ "$ENABLED_SET" == false ]] || fail "Option --enabled may only be supplied once."
            [[ "$2" == true || "$2" == false ]] || fail "Invalid --enabled '$2'. Use true or false."
            ENABLED_SET=true
            ENABLED_VALUE="$2"
            shift 2
            ;;
        --follow-up-status)
            require_value "$@"
            [[ "$STATUS_SET" == false ]] || fail "Option --follow-up-status may only be supplied once."
            case "$2" in
                'In Progress'|Retry|Completed|Stopped) ;;
                *) fail "Invalid --follow-up-status '$2'. Use In Progress, Retry, Completed, or Stopped." ;;
            esac
            STATUS_SET=true
            STATUS_VALUE="$2"
            shift 2
            ;;
        --clear-follow-up-status)
            [[ "$CLEAR_STATUS" == false ]] || fail "Option --clear-follow-up-status may only be supplied once."
            CLEAR_STATUS=true
            shift
            ;;
        --attempt-count)
            require_value "$@"
            [[ "$ATTEMPT_SET" == false ]] || fail "Option --attempt-count may only be supplied once."
            [[ "$2" =~ ^[0-9]{1,2}$ ]] || fail "Invalid --attempt-count '$2'. Use an integer from 0 to 99."
            ATTEMPT_SET=true
            ATTEMPT_VALUE="$2"
            shift 2
            ;;
        --retry-in)
            require_value "$@"
            [[ "$RETRY_IN_SET" == false ]] || fail "Option --retry-in may only be supplied once."
            validate_duration "$2"
            RETRY_IN_SET=true
            RETRY_IN_VALUE="$2"
            shift 2
            ;;
        --retry-at)
            require_value "$@"
            [[ "$RETRY_AT_SET" == false ]] || fail "Option --retry-at may only be supplied once."
            validate_retry_at "$2"
            RETRY_AT_SET=true
            RETRY_AT_INPUT="$2"
            shift 2
            ;;
        --clear-retry)
            [[ "$CLEAR_RETRY" == false ]] || fail "Option --clear-retry may only be supplied once."
            CLEAR_RETRY=true
            shift
            ;;
        --target-org)
            require_value "$@"
            [[ "$TARGET_ORG" == "" ]] || fail "Option --target-org may only be supplied once."
            [[ "$2" != -* ]] || fail "Invalid --target-org '$2'."
            TARGET_ORG="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --*)
            fail "Unknown option: $1"
            ;;
        -*)
            fail "Unknown option: $1"
            ;;
        *)
            [[ "$QUOTE_ID" == "" ]] || fail "Only one QUOTE_ID positional argument is allowed."
            QUOTE_ID="$1"
            shift
            ;;
    esac
done

[[ -n "$QUOTE_ID" ]] || fail "QUOTE_ID is required."
[[ "$QUOTE_ID" =~ ^0Q[A-Za-z0-9]{13}([A-Za-z0-9]{3})?$ ]] || \
    fail "Invalid QUOTE_ID '$QUOTE_ID'. Use a 15- or 18-character Salesforce Quote ID beginning with 0Q."

[[ "$STATUS_SET" == false || "$CLEAR_STATUS" == false ]] || \
    fail "--follow-up-status and --clear-follow-up-status cannot be combined."
[[ "$RETRY_IN_SET" == false || "$RETRY_AT_SET" == false ]] || \
    fail "--retry-in and --retry-at cannot be combined."
[[ "$CLEAR_RETRY" == false || "$RETRY_IN_SET" == false ]] || \
    fail "--clear-retry cannot be combined with --retry-in."
[[ "$CLEAR_RETRY" == false || "$RETRY_AT_SET" == false ]] || \
    fail "--clear-retry cannot be combined with --retry-at."

if [[ "$RETRY_IN_SET" == true || "$RETRY_AT_SET" == true ]]; then
    [[ "$CLEAR_STATUS" == false ]] || \
        fail "A retry schedule cannot be combined with --clear-follow-up-status."
    if [[ "$STATUS_SET" == true && "$STATUS_VALUE" != Retry ]]; then
        fail "A retry schedule requires --follow-up-status Retry or no explicit status."
    fi
fi

SETTER_COUNT=0
[[ "$ENABLED_SET" == true ]] && SETTER_COUNT=$((SETTER_COUNT + 1))
[[ "$STATUS_SET" == true || "$CLEAR_STATUS" == true ]] && SETTER_COUNT=$((SETTER_COUNT + 1))
[[ "$ATTEMPT_SET" == true ]] && SETTER_COUNT=$((SETTER_COUNT + 1))
[[ "$RETRY_IN_SET" == true || "$RETRY_AT_SET" == true || "$CLEAR_RETRY" == true ]] && SETTER_COUNT=$((SETTER_COUNT + 1))
((SETTER_COUNT > 0)) || fail "At least one field setter is required."

if [[ "$RETRY_IN_SET" == true ]]; then
    compute_retry_in "$RETRY_IN_VALUE"
elif [[ "$RETRY_AT_SET" == true ]]; then
    # validate_retry_at has already normalized this value before any external
    # Salesforce command is checked.
    :
fi

command -v sf >/dev/null 2>&1 || fail "Salesforce CLI (sf) is not installed or is not on PATH."
command -v jq >/dev/null 2>&1 || fail "jq is required to inspect Salesforce CLI JSON responses."

ORG_ARGS=()
if [[ -n "$TARGET_ORG" ]]; then
    ORG_ARGS+=(--target-org "$TARGET_ORG")
fi

SOQL="SELECT Id, Name, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c FROM Quote WHERE Id = '$QUOTE_ID' LIMIT 1"

if ! BEFORE_JSON="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$SOQL" --json)"; then
    fail "Salesforce query failed for Quote $QUOTE_ID."
fi

if ! BEFORE_RECORD="$(jq -ce '.result.records[0] // empty' <<<"$BEFORE_JSON" 2>/dev/null)"; then
    if [[ "$(jq -r '.result.totalSize // 0' <<<"$BEFORE_JSON" 2>/dev/null)" == 0 ]]; then
        printf '[INFO] Quote %s was not found; no update was made.\n' "$QUOTE_ID"
        exit 0
    fi
    fail "Salesforce returned an unexpected JSON response for Quote $QUOTE_ID."
fi

print_snapshot() {
    local label="$1"
    local payload="$2"
    jq -r --arg label "$label" '
        def safe:
          if . == null then "(null)"
          elif type == "string" then @json
          else tostring
          end;
        (.result.records[0] // {}) as $quote |
        "\($label)" +
        "\n  Id: " + (($quote.Id) | safe) +
        "\n  Name: " + (($quote.Name) | safe) +
        "\n  QuoteWake_Enabled__c: " + (($quote.QuoteWake_Enabled__c) | safe) +
        "\n  Follow_Up_Status__c: " + (($quote.Follow_Up_Status__c) | safe) +
        "\n  Next_Follow_Up_At__c: " + (($quote.Next_Follow_Up_At__c) | safe) +
        "\n  Attempt_Count__c: " + (($quote.Attempt_Count__c) | safe)
    ' <<<"$payload"
}

print_snapshot '[Before update]' "$BEFORE_JSON"

VALUES=""
append_value() {
    if [[ -n "$VALUES" ]]; then
        VALUES+=" "
    fi
    VALUES+="$1"
}

if [[ "$ENABLED_SET" == true ]]; then
    append_value "QuoteWake_Enabled__c=$ENABLED_VALUE"
fi

if [[ "$RETRY_IN_SET" == true || "$RETRY_AT_SET" == true ]]; then
    append_value "Follow_Up_Status__c='Retry'"
elif [[ "$STATUS_SET" == true ]]; then
    append_value "Follow_Up_Status__c='$STATUS_VALUE'"
elif [[ "$CLEAR_STATUS" == true ]]; then
    append_value "Follow_Up_Status__c="
fi

if [[ "$RETRY_IN_SET" == true || "$RETRY_AT_SET" == true ]]; then
    append_value "Next_Follow_Up_At__c=$RETRY_AT_VALUE"
elif [[ "$CLEAR_RETRY" == true ]]; then
    append_value "Next_Follow_Up_At__c="
fi

if [[ "$ATTEMPT_SET" == true ]]; then
    append_value "Attempt_Count__c=$ATTEMPT_VALUE"
fi

if ! sf data update record ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --sobject Quote --record-id "$QUOTE_ID" --values "$VALUES" --json >/dev/null; then
    fail "Salesforce update failed for Quote $QUOTE_ID."
fi

if ! AFTER_JSON="$(sf data query ${ORG_ARGS[@]+"${ORG_ARGS[@]}"} --query "$SOQL" --json)"; then
    fail "Salesforce post-update query failed for Quote $QUOTE_ID."
fi
if ! jq -e '.result.records[0] // empty' <<<"$AFTER_JSON" >/dev/null 2>&1; then
    fail "Salesforce returned no Quote after updating $QUOTE_ID."
fi

print_snapshot '[After update]' "$AFTER_JSON"
printf '[OK] Quote %s updated successfully.\n' "$QUOTE_ID"
