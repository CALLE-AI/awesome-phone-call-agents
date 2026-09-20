#!/usr/bin/env bash
# Bytelytic Clinic OS — cURL Quickstart Examples
# Requires: curl, jq
# Start the server first: python app.py --serve

BASE="http://127.0.0.1:8000"
KEY="bytelytic_demo_key_2026"

echo "=== Health Check ==="
curl -s "$BASE/health" | jq .

echo "\n=== 24-Hour Confirmation Call (dry-run) ==="
curl -s -X POST "$BASE/calls/confirmation" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+15550192834","patient_name":"Jane Doe","appointment_time":"Tomorrow at 10:30 AM"}' | jq .

echo "\n=== No-Show Recovery Call (dry-run) ==="
curl -s -X POST "$BASE/calls/no-show" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+15550192834","patient_name":"Jane Doe","missed_appointment_time":"Today at 9:00 AM"}' | jq .

echo "\n=== Prior Auth IVR Call (dry-run) ==="
curl -s -X POST "$BASE/calls/prior-auth" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"payor_phone":"1-800-676-2583","payor_name":"Blue Cross Blue Shield","cpt_code":"99213","member_id_masked":"MBR-***-8492"}' | jq .

echo "\n=== Webhook (Operator Review Required) ==="
curl -s -X POST "$BASE/calle/webhook" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"structured_result":{"will_attend":"yes"},"operator_reviewed":false,"appointment_id":"apt-101"}' | jq .

echo "\n=== Webhook (Operator Reviewed — EHR Update Applied) ==="
curl -s -X POST "$BASE/calle/webhook" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"structured_result":{"will_attend":"yes"},"operator_reviewed":true,"appointment_id":"apt-101"}' | jq .
