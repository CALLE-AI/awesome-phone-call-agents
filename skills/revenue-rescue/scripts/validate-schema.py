import json
from jsonschema import validate, ValidationError

# Load the schema
with open('../references/schema.json') as f:
    schema = json.load(f)

# Mock CALL-E response
mock_result = {
    "outcome": "payment_promised",
    "promised_date": "2026-09-10",
    "dispute_reason": None,
    "escalation_required": False,
    "notes": "Customer agreed to update card via secure email link."
}

try:
    validate(instance=mock_result, schema=schema)
    print("✅ Schema Validation Passed: The result strictly matches the defined schema.")
except ValidationError as e:
    print(f"❌ Schema Validation Failed: {e.message}")