# Examples

These examples demonstrate the input parameters, call execution flow, and structured output returned by `hifi-hotel-negotiator`.

The phone numbers in these examples use reserved fictional `555-01xx` numbers.

## Hotel Discovery & Negotiation Setup

User request:

```text
Find and negotiate direct rates for Ocean Pearl Resort (+15550101234) for 2 adults from 2026-10-12 to 2026-10-17 with a budget cap of $1,200.
```

Extracted fields:

```json
{
  "hotel_name": "Ocean Pearl Resort",
  "hotel_phone": "+15550101234",
  "check_in": "2026-10-12",
  "check_out": "2026-10-17",
  "adults": 2,
  "children": 0,
  "rooms": 1,
  "budget_cap": 1200.0,
  "currency": "USD",
  "preferences": {
    "breakfast": true,
    "free_cancellation": true
  }
}
```

## Audio Call Transcript

```text
[00:02] Agent: "Good afternoon! I'm an AI travel assistant calling on behalf of a guest inquiring about room availability from October 12th to October 17th for two adults."
[00:09] Hotel: "Good afternoon! Yes, we have our Deluxe King Room available for those dates."
[00:15] Agent: "Could you share the total rate for the 5-night stay including all taxes and fees?"
[00:21] Hotel: "The standard rate is $1,100 total, including all local taxes and service fees."
[00:29] Agent: "Understood. The traveler is comparing a few shortlisted properties in the area. Can you offer a preferential direct-booking rate or include breakfast?"
[00:38] Hotel: "If you book direct with us today, we can offer a direct rate of $980 total, and include daily buffet breakfast and free airport shuttle."
[00:52] Agent: "That sounds great. What is the cancellation policy on this direct rate?"
[00:57] Hotel: "You can cancel free of charge up to 48 hours prior to check-in."
[01:03] Agent: "Wonderful. Just to confirm: Deluxe King from Oct 12 to Oct 17 for $980 total, including daily breakfast, airport shuttle, and free cancellation up to 48 hours prior."
[01:14] Hotel: "Yes, that is completely correct!"
[01:18] Agent: "Thank you so much for your assistance. Have a wonderful day!"
```

## Generated Structured Result

```json
{
  "availability": "available",
  "room_type": "Deluxe King",
  "max_guests": 2,
  "price_per_night": 196.0,
  "total_price": 1100.0,
  "currency": "USD",
  "taxes_included": true,
  "mandatory_fees": 0.0,
  "breakfast_included": true,
  "breakfast_price": null,
  "airport_transfer_available": true,
  "airport_transfer_price": null,
  "free_cancellation": true,
  "cancellation_deadline": "48 hours prior to check-in",
  "advance_payment_required": false,
  "original_total": 1100.0,
  "negotiated_total": 980.0,
  "negotiated_savings": 120.0,
  "special_benefits": [
    "Complimentary daily buffet breakfast for 2",
    "Free airport shuttle",
    "Free cancellation up to 48h before arrival"
  ],
  "notes": "Verified directly via CALL-E voice agent."
}
```
