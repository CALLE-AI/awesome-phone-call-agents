# Examples

## Qualifying call (masked)

Input enquiry from Supabase:
- product_asked: "distribution board d6 three phase"
- created_at: within the last 72 hours
- whatsapp_responded: false
- known_competitor: false
- already_purchased: false
- opted_out: false

Price lookup against the price sheet resolves to 42,500 NGN for the matched item.

Scoring result: category = Distribution Board, value = 42,500 >= 35,000 threshold, recency and disqualifier checks pass. Result: qualifies for a call.

CALL-E plan_call is invoked with a goal describing the product, price, and asking about interest plus pickup or delivery preference. Once plan_call returns ready_to_run = true, run_call places the call.

Real test outcome (masked): the callee confirmed interest and selected delivery. Call completed in 55 seconds. task_completed = true, completion_confidence = 0.86 (high).

## Non-qualifying example

Input enquiry:
- product_asked: "knockout box"
- estimated value: 250 NGN

Category resolves to Box/Conduit, threshold is 2,500 NGN. 250 is below threshold. Result: does not qualify, no call is placed.

## Disqualified example

Input enquiry:
- product_asked: "distribution board d8 three phase"
- estimated value: 53,000 NGN (above threshold)
- already_purchased: true

Even though the price qualifies, the already_purchased disqualifier blocks the call. Result: does not qualify, no call is placed.