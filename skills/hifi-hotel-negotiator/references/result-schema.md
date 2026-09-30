# Structured Result Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "HotelProcurementResult",
  "type": "object",
  "required": [
    "availability",
    "currency"
  ],
  "properties": {
    "availability": {
      "type": "string",
      "enum": ["available", "unavailable", "unknown"]
    },
    "room_type": { "type": ["string", "null"] },
    "max_guests": { "type": ["integer", "null"] },
    "price_per_night": { "type": ["number", "null"] },
    "total_price": { "type": ["number", "null"] },
    "currency": { "type": "string" },
    "taxes_included": { "type": ["boolean", "null"] },
    "mandatory_fees": { "type": ["number", "null"] },
    "breakfast_included": { "type": ["boolean", "null"] },
    "breakfast_price": { "type": ["number", "null"] },
    "airport_transfer_available": { "type": ["boolean", "null"] },
    "airport_transfer_price": { "type": ["number", "null"] },
    "free_cancellation": { "type": ["boolean", "null"] },
    "cancellation_deadline": { "type": ["string", "null"] },
    "advance_payment_required": { "type": ["boolean", "null"] },
    "advance_payment_amount": { "type": ["number", "null"] },
    "extra_bed_available": { "type": ["boolean", "null"] },
    "extra_bed_price": { "type": ["number", "null"] },
    "early_checkin_available": { "type": ["boolean", "null"] },
    "late_checkout_available": { "type": ["boolean", "null"] },
    "original_total": { "type": ["number", "null"] },
    "negotiated_total": { "type": ["number", "null"] },
    "negotiated_savings": { "type": ["number", "null"] },
    "special_benefits": {
      "type": "array",
      "items": { "type": "string" }
    },
    "notes": { "type": ["string", "null"] }
  }
}
```
