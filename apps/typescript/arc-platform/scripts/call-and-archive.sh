#!/usr/bin/env bash
# One command, for the moment CALL-E's create endpoint opens.
#
#   ./scripts/call-and-archive.sh <planItemId>       # from a campaign's line
#   ./scripts/call-and-archive.sh city-fm-89-khi     # standalone, no line
#
# PREFER A PLAN LINE ID. A call placed from one carries its campaign, so its
# confirmed rate lands on that line and the plan can link to the moment it was
# said. A standalone call has no line to appear on and no "heard here" is ever
# rendered - that is what a standalone call is, not a fault.
#
# Places ONE call - never a loop - and prints the call id immediately so the
# phone can be answered. Then waits for it to finish and archives it whole:
# transcript, timings, events, negotiation, our own record.
#
# If create is refused it prints the timestamp and the provider's code and
# stops. That line goes into docs/calle-support.md section 6.
set -uo pipefail
cd "$(dirname "$0")/.."

ARG="${1:-}"
if [ -z "$ARG" ]; then
  echo "Give a plan line id (preferred) or a catalogue id."
  echo "  ./scripts/call-and-archive.sh <planItemId>"
  exit 2
fi

# A plan line id is a cuid; a catalogue id has hyphens and words in it.
if [[ "$ARG" == *-* ]]; then
  echo "=== $(date -u '+%Y-%m-%d %H:%M:%SZ')  standalone call to ${ARG} (no plan line) ==="
  OUT="$(node scripts/place-call.mjs "$ARG" --place 2>&1)"
else
  echo "=== $(date -u '+%Y-%m-%d %H:%M:%SZ')  calling from plan line ${ARG} ==="
  OUT="$(node scripts/place-call.mjs --item "$ARG" --place 2>&1)"
fi

if ! grep -q "CALL PLACED" <<<"$OUT"; then
  echo "REFUSED at $(date -u '+%Y-%m-%d %H:%M:%SZ')"
  grep -E "code:|status:|create failed|REFUSING|NO MANDATE" <<<"$OUT" | head -4
  echo
  echo "Not retrying. Add the timestamp above to docs/calle-support.md section 6."
  exit 1
fi

CALL_ID="$(grep -oE 'call_[A-Za-z0-9_-]+' <<<"$OUT" | head -1)"
grep -E "CAMPAIGN:|PLAN LINE:|target |walk-away|lever " <<<"$OUT"
echo
echo "  >>> CALL ID: ${CALL_ID}   — answer the phone <<<"
echo

# Poll our own reconcile rather than CALL-E directly: it writes the result into
# the record as it goes, so the archive below has our side too.
for i in $(seq 1 60); do
  sleep 20
  node scripts/reconcile-stuck.mjs --apply >/dev/null 2>&1
  STATE="$(node scripts/recent-calls-state.mjs "$CALL_ID" 2>/dev/null || echo unknown)"
  echo "  $(date -u '+%H:%M:%SZ')  ${STATE}"
  if [ "$STATE" = "done" ]; then break; fi
done

echo
node scripts/archive-call.mjs "$CALL_ID"
echo
echo "=== archived. The call never needs placing again. ==="
