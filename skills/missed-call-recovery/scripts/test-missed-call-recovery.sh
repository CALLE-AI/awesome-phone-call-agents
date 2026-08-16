#!/usr/bin/env bash
# Functional test for missed-call-recovery skill (dry-run only, no real calls).
set -u
REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$REPO_ROOT"
SKILL=skills/missed-call-recovery
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0; failed=0
check() { # name expected_substring actual_text
  if printf '%s' "$3" | grep -qF "$2"; then pass=$((pass+1)); echo "PASS: $1";
  else failed=$((failed+1)); echo "FAIL: $1 (wanted '$2')"; printf '%s\n' "$3" | sed 's/^/  /'; fi
}

cat > "$TMP/event.json" <<'EOF'
{
  "eventId": "mc-2026-08-15-000042",
  "callerPhoneNumber": "+15551230142",
  "callerName": "Dana",
  "businessName": "Example Dental",
  "missedAt": "2026-08-14T11:41:00-07:00",
  "timezone": "America/Los_Angeles",
  "language": "English",
  "availableSlots": ["2026-08-16 09:00", "2026-08-16 11:30"]
}
EOF

# 1. Dry-run default: places no call and records no state (no side effects)
out=$(python3 $SKILL/scripts/missed_call_recovery.py --event "$TMP/event.json" --state "$TMP/state.json" 2>&1)
check "dry-run banner" "DRY-RUN: no call will be placed" "$out"
check "masked phone" "+1555****0142" "$out"
check "idempotency key" "recovery:mc-2026-08-15-000042:1:" "$out"
if [ ! -f "$TMP/state.json" ]; then pass=$((pass+1)); echo "PASS: dry-run records no state";
else
  attempts=$(python3 -c "import json;print(json.load(open('$TMP/state.json'))['events']['mc-2026-08-15-000042']['attempts'])")
  if [ "$attempts" = "0" ]; then pass=$((pass+1)); echo "PASS: dry-run records no attempts";
  else failed=$((failed+1)); echo "FAIL: dry-run recorded attempt $attempts"; fi
fi

# 2. Missing timezone -> not called
python3 - <<EOF
import json,pathlib
e=json.load(open("$TMP/event.json")); e.pop("timezone"); e["eventId"]="mc-no-tz"
pathlib.Path("$TMP/event-notz.json").write_text(json.dumps(e))
EOF
out=$(python3 $SKILL/scripts/missed_call_recovery.py --event "$TMP/event-notz.json" --state "$TMP/state.json" 2>&1)
check "missing timezone blocked" "missing required field: timezone" "$out"

# 3. Non-E164 number blocked
python3 - <<EOF
import json,pathlib
e=json.load(open("$TMP/event.json")); e["callerPhoneNumber"]="555-123-0142"; e["eventId"]="mc-badnum"
pathlib.Path("$TMP/event-badnum.json").write_text(json.dumps(e))
EOF
out=$(python3 $SKILL/scripts/missed_call_recovery.py --event "$TMP/event-badnum.json" --state "$TMP/state.json" 2>&1)
check "non-E164 blocked" "callerPhoneNumber is not E.164" "$out"

# 4. After-hours miss -> not called, next-morning note
python3 - <<EOF
import json,pathlib
e=json.load(open("$TMP/event.json")); e["missedAt"]="2026-08-14T22:10:00-07:00"; e["eventId"]="mc-late"
pathlib.Path("$TMP/event-late.json").write_text(json.dumps(e))
EOF
out=$(python3 $SKILL/scripts/missed_call_recovery.py --event "$TMP/event-late.json" --state "$TMP/state.json" 2>&1)
check "after-hours blocked" "next business morning" "$out"

# 5. Unit-level: validate_result / classify / mask / redact
out=$(python3 - "$SKILL" <<'EOF'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("mcr", sys.argv[1] + "/scripts/missed_call_recovery.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
# good result
v, errs = m.validate_result({"consent_granted": True, "disposition": "Completed",
  "disposition_evidence": "caller said yes", "lead_intent": "Booking", "urgency": "Urgent",
  "callback_slot": "tomorrow at 9", "wants_booking": True, "sneaky_undeclared": "x"})
assert errs == [] and "sneaky_undeclared" not in v, (errs, v)
print("validate ok")
# out-of-enum refused
v2, errs2 = m.validate_result({"consent_granted": True, "disposition": "Completed",
  "disposition_evidence": "e", "lead_intent": "maybe"})
assert any("lead_intent" in e for e in errs2) and "lead_intent" not in v2
print("enum-refusal ok")
# missing consent -> needs-review
v3, errs3 = m.validate_result({"disposition": "Completed", "lead_intent": "Booking"})
c3 = m.classify(v3, errs3, "COMPLETED")
assert c3["outcome"] == "needs-review", c3
print("missing-consent review ok")
# refusal dominates
c4 = m.classify({"consent_granted": False, "disposition": "DoNotCall", "disposition_evidence": "stop"}, [], "COMPLETED")
assert c4["outcome"] == "declined" and c4["disposition"] == "DoNotCall"
print("refusal-dominance ok")
# not-reached from provider status, empty result
c5 = m.classify({}, [], "NO_ANSWER")
assert c5["outcome"] == "not-reached", c5
print("not-reached ok")
# redaction walks nested + masks phones
r = m.redact({"token": "s", "nested": {"refresh_token": "s", "phone": "+15551230142"}})
assert r["token"] == "[redacted]" and r["nested"]["refresh_token"] == "[redacted]"
assert r["nested"]["phone"] == "+1555****0142"
print("redact ok")
EOF
)
check "unit suite" "redact ok" "$out"

# 6. Fake calle binary: execute path against a stub CLI, dashboard against local receiver
cat > "$TMP/calle" <<'EOF'
#!/usr/bin/env bash
# fake CALL-E CLI: logs the subcommand only (never the dialed number), returns canned JSON
echo "{\"cmd\": \"$1 $2\"}" >> "$(dirname "$0")/calle-log.jsonl"
if [ "$1 $2" = "call start" ]; then
  echo "{\"run_id\": \"run-fake-1\", \"status\": \"RUNNING\"}"
else
  echo "{\"run_id\": \"run-fake-1\", \"status\": \"COMPLETED\", \"result\": {\"result\": {\"consent_granted\": true, \"disposition\": \"Completed\", \"disposition_evidence\": \"caller answered\", \"lead_intent\": \"Booking\", \"need_summary\": \"chipped tooth\", \"urgency\": \"Urgent\", \"callback_slot\": \"tomorrow at 9 if possible\", \"wants_booking\": true}}}"
fi
EOF
chmod +x "$TMP/calle"
python3 - <<EOF
import http.server, threading, json
class R(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n))
        with open("$TMP/dashboard-received.json", "w") as f: json.dump(body, f)
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 8765), R)
threading.Thread(target=srv.serve_forever, daemon=True).start()
import subprocess, sys, os, time
env = dict(os.environ)
proc = subprocess.run([sys.executable, "skills/missed-call-recovery/scripts/missed_call_recovery.py",
  "--event", "$TMP/event.json", "--state", "$TMP/state.json",
  "--execute", "--approved-real-calls", "--poll", "--poll-timeout", "30", "--poll-interval", "1",
  "--output", "$TMP/results.jsonl", "--calle-bin", "$TMP/calle",
  "--dashboard-webhook", "http://127.0.0.1:8765/hook"],
  capture_output=True, text=True, env=env, timeout=60)
print(proc.stdout); print(proc.stderr, file=sys.stderr)
srv.shutdown()
EOF
out=$(cat "$TMP/results.jsonl" 2>/dev/null)
check "exec outcome recovered" '"outcome": "recovered"' "$out"
check "exec masked caller in payload" '"masked_caller": "+1555****0142"' "$out"
check "exec lead intent posted" '"lead_intent": "Booking"' "$out"
plaintext_hits=$(grep -lF "+15551230142" "$TMP/results.jsonl" "$TMP/dashboard-received.json" 2>/dev/null | wc -l | tr -d ' ')
if [ "$plaintext_hits" = "0" ]; then pass=$((pass+1)); echo "PASS: no plaintext number in result/dashboard artifacts";
else failed=$((failed+1)); echo "FAIL: plaintext number leaked in result/dashboard artifact(s)"; grep -lF "+15551230142" "$TMP/results.jsonl" "$TMP/dashboard-received.json" 2>/dev/null; fi
received=$(cat "$TMP/dashboard-received.json" 2>/dev/null)
check "dashboard received pending slot as text" "tomorrow at 9 if possible" "$received"
check "event marked done in state" '"done": true' "$(cat "$TMP/state.json")"

# 7. Re-running the same event -> blocked (dedupe)
out=$(python3 $SKILL/scripts/missed_call_recovery.py --event "$TMP/event.json" --state "$TMP/state.json" 2>&1)
check "dedupe blocks second conversation" "event already has a completed recovery conversation" "$out"

echo ""
echo "RESULTS: pass=$pass fail=$failed"
[ "$failed" -eq 0 ]
