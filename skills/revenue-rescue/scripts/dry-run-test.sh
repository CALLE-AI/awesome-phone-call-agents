#!/bin/bash
# dry-run-test.sh
# Tests the Revenue Rescue webhook logic using a mock payload.
# Requires the backend to be running locally with CALL_E_DRY_RUN=true.

echo "🧪 Starting Revenue Rescue Dry-Run Test..."
echo "⚠️  Ensure your backend is running and CALL_E_DRY_RUN=true in your .env file."

# Send the mock payload to the local backend
RESPONSE=$(curl -s -X POST http://localhost:8000/webhook/revenue-rescue \
  -H "Content-Type: application/json" \
  -d @fixtures/mock-payload.json)

echo "📥 Raw Response:"
echo "$RESPONSE" | jq .

# Basic validation check
OUTCOME=$(echo "$RESPONSE" | jq -r '.result.outcome // empty')

if [ "$OUTCOME" == "payment_promised" ]; then
    echo "✅ SUCCESS: Dry-run returned expected structured outcome."
else
    echo "❌ FAIL: Expected 'payment_promised', got '$OUTCOME'."
    exit 1
fi