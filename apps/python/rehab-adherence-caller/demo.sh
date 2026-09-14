#!/bin/sh
# Paced demo runner for screen recording. Places no call.
#
# Types each command out at a readable speed, then runs it, then pauses long
# enough to read the output. The point is a deterministic take: run it again and
# the timing is identical, so a re-record does not mean re-performing.
#
#   ./demo.sh          full run, ~95s
#   ./demo.sh fast     no typing delay, for checking content
#
# Recommended terminal: 100x40, large font. Nothing here needs credentials.

set -eu

COURSE="examples/course.example.json"
RESPONSES="examples/responses.example.json"
TODAY="2026-08-11"

if [ "${1:-}" = "fast" ]; then
  TYPE_DELAY=0
  READ_PAUSE=0.4
else
  TYPE_DELAY=0.028
  READ_PAUSE=1
fi

BOLD=$(printf '\033[1m')
DIM=$(printf '\033[2m')
CYAN=$(printf '\033[36m')
RESET=$(printf '\033[0m')

pause() {
  # pause <multiplier of READ_PAUSE>
  sleep "$(awk -v s="$READ_PAUSE" -v m="$1" 'BEGIN { printf "%.2f", s * m }')"
}

if [ "$TYPE_DELAY" = "0" ]; then
  type_out() { printf '%s$ %s%s%s\n' "$DIM" "$BOLD" "$1" "$RESET"; }
else
  type_out() {
    # One character at a time. Bold is opened once, not per character, so the
    # recording does not carry an escape pair between every letter.
    printf '%s$ %s%s' "$DIM" "$RESET" "$BOLD"
    i=1
    len=${#1}
    while [ "$i" -le "$len" ]; do
      printf '%s' "$(printf '%s' "$1" | cut -c "$i")"
      sleep "$TYPE_DELAY"
      i=$((i + 1))
    done
    printf '%s\n' "$RESET"
  }
fi

say() {
  printf '\n%s%s%s\n\n' "$CYAN" "$1" "$RESET"
}

run() {
  type_out "$1"
  printf '\n'
  eval "$1"
  printf '\n'
}

clear

say "# Rehab is a course, not an appointment. Who is sliding out of it?"
pause 1
run "python3 -m rehab_adherence preview --course $COURSE --today $TODAY"
pause 5

clear
say "# Ivy and Omar both missed exactly one session. The same one."
pause 1
run "python3 -m rehab_adherence preview --course $COURSE --today $TODAY | head -12"
pause 5

clear
say "# History is the only difference. It changes what the caller says."
pause 1
run "python3 -m rehab_adherence preview --course $COURSE --today $TODAY --show-task p_ivy | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"task\"].split(\"Say Ivy\")[1].split(\"You are arranging\")[0].strip())'"
pause 4
run "python3 -m rehab_adherence preview --course $COURSE --today $TODAY --show-task p_omar | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"task\"].split(\"Say Omar\")[1].split(\"You are arranging\")[0].strip())'"
pause 5

clear
say "# Now run the course. No network, no credentials, no telephone."
pause 1
run "python3 -m rehab_adherence run --course $COURSE --fixture $RESPONSES --today $TODAY"
pause 6

clear
say "# What was actually said. CALL-E returns the conversation, speaker-tagged."
pause 1
run "python3 -m rehab_adherence run --course $COURSE --fixture $RESPONSES --today $TODAY --transcripts 2>/dev/null | sed -n '/CALL  p_rosa/,/ESCALATED/p'"
pause 7

clear
say "# And the whole thing is tested without credentials."
pause 1
run "python3 -m pytest -q"
pause 3
