---
name: hifi-hotel-negotiator
description: Autonomous voice AI agent skill for hotel procurement, direct-booking rate negotiation, and reservation confirmation over the phone using CALL-E.
license: MIT
---

# HiFi Hotel Negotiator

## Overview

`hifi-hotel-negotiator` is a goal-driven phone execution skill designed for the CALL-E platform. Instead of accepting static online aggregator prices, this agent calls shortlisted hotels directly, verifies availability and hidden policies (taxes, resort fees, breakfast, cancellation), politely negotiates direct-booking discounts or complimentary value-adds, and returns verified structured JSON offers.

## Supported Call Modes

1. **Discovery & Verification Call**: Verify exact dates, room occupancy, nightly/total rates, breakfast cost, airport transfers, and cancellation terms. See `references/hotel-discovery.md`.
2. **Direct Rate Negotiation**: Politely inquire about preferential direct rates, complimentary breakfast, free airport shuttles, or complimentary room upgrades. See `references/negotiation-policy.md`.
3. **Reservation Confirmation Call**: Re-verify negotiated rate, dates, and inclusions with the front desk and obtain the official booking reference number. See `references/confirmation-policy.md`.

## Required Call Inputs

| Input Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `hotel_name` | String | Official hotel name | `"Ocean Pearl Resort"` |
| `hotel_phone` | String (E.164) | Validated hotel front-desk phone | `"+15550101234"` |
| `check_in` | ISO Date | Arrival date | `"2026-10-12"` |
| `check_out` | ISO Date | Departure date | `"2026-10-17"` |
| `adults` | Integer | Number of adult guests | `2` |
| `children` | Integer | Number of children | `0` |
| `rooms` | Integer | Number of rooms required | `1` |
| `budget_cap` | Number | Maximum total budget limit | `50000` |
| `currency` | String | Currency code | `"INR"` |
| `preferences` | Object | Desired perks (breakfast, free cancellation, transfer) | `{ breakfast: true, cancellation: true }` |

## Verification Checklist

The voice agent must explicitly verify:
- [x] Room availability for requested dates and party size.
- [x] Quoted room category and max occupancy.
- [x] Total price for the entire stay and whether taxes are included.
- [x] Any mandatory resort or facility fees.
- [x] Daily breakfast inclusions and pricing.
- [x] Advance deposit or prepayment requirements.
- [x] Cancellation policy and deadline.
- [x] Airport transfer options and cost.

## Negotiation Policy & Guardrails

- **Polite Tone**: Always maintain a respectful, professional tone:
  > *"The guest is reviewing a couple of shortlisted properties in the area. Can you offer a preferential direct-booking rate for this stay?"*
- **Value-Add Fallback**: If the hotel cannot lower the room price, request value additions:
  1. Complimentary buffet breakfast
  2. Free airport shuttle
  3. Room category upgrade
  4. Late checkout
- **Strict Budget Ceiling**: Never agree to or quote any rate exceeding the traveler's configured `budget_cap`.
- **Zero Payment Disclosure**: Never disclose credit card numbers or financial credentials during discovery.

## Output Contract & Validation

Calls must return a schema-valid JSON object adhering to `references/result-schema.md`. Use `scripts/validate_offer.py` to validate structured outputs against business constraints.

See `references/examples.md` for end-to-end conversation transcripts and result payloads.

## Safety & Boundaries

Read `references/safety.md` for full safety, privacy, and consent requirements.

1. **Explicit Consent**: Real-world phone calls are only placed after user action.
2. **No Data Fabrication**: If a field was not discussed or confirmed by the receptionist, return `null` — never assume `false` or invent numbers.
3. **Confirmation Guardrail**: A reservation is only marked confirmed if the hotel explicitly issues a valid booking reference number.

