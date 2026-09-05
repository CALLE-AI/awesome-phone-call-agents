---
name: ocmanjos-lead-qualifier
description: Qualifies inbound sales enquiries from a Supabase-backed WhatsApp sales AI and places outbound follow-up calls via CALL-E for high-value, recently-active leads.
---

# O.C. Manjos Lead Qualifier

Scores inbound product enquiries (captured via a WhatsApp sales AI into Supabase) against category, price, and recency rules, then places a CALL-E outbound call to qualifying leads to confirm interest and capture delivery or pickup preference.

## Use it for
- Following up on high-value product enquiries that went unanswered on WhatsApp within 72 hours
- Confirming customer interest and delivery preference via voice instead of relying on repeat text follow-ups
- Demonstrating a real small-business use case for CALL-E: filtering noisy, free-text enquiry data down to genuinely qualifying leads before spending a call

## Do not use it to
- Call numbers not sourced from an explicit customer enquiry
- Call leads marked as already purchased, a known competitor, or opted out
- Guess phone numbers, prices, or product categories - the skill only prices and calls what matches configured rules and real price-sheet data

## Setup
1. A Supabase table with enquiry records (product_asked, created_at, whatsapp_responded, known_competitor, already_purchased, opted_out)
2. A product price sheet (.xlsx) with description, unit price, and sell price columns
3. .env with SUPABASE_URL and SUPABASE_ANON_KEY (never commit this file)
4. CALL-E CLI authenticated (calle auth login)

## How it works
1. Pull recent enquiries from Supabase
2. Extract a product keyword and variant (e.g. size/phase) from free-text product_asked
3. Look up the real sell price from the price sheet, matched by token, not exact phrase
4. Score against category/price/recency/disqualifier rules
5. For qualifying leads, call CALL-E's plan_call, review the plan, then run_call

## Qualification rule (example, tune to your own product line)
IF (category = "Distribution Board" AND value >= 35000)
   OR (category = "Box/Conduit" AND value >= 2500)
   OR (category = "Solar/Flood Light" AND value >= 34000)
AND enquiry_age <= 72h AND no_whatsapp_response = true
AND NOT (known_competitor OR already_purchased OR opted_out)
THEN CALL

## Side effects
This skill places real outbound phone calls when a lead qualifies. Each call consumes CALL-E call credits. Always review plan_call output (ready_to_run, confirm_summary) before calling run_call - this repository's rules prohibit placing a setup-time test call without the user explicitly asking for one.

## Example (masked)
Phone: +15550101234 (masked example - never a real customer number in samples)
Product: 3-phase distribution board (D6)
Price: 42,500 NGN
Result: customer confirmed interest, requested delivery, did not provide delivery details before call ended

## Known limitations
- Keyword/variant extraction currently only handles size and phase patterns for the Distribution Board category; other multi-variant product lines need similar extraction logic added
- Phone numbers must currently be sourced manually until a WhatsApp Business API integration writes them into Supabase directly
- Call-outcome confidence scoring can register high confidence on an abrupt or ambiguous call ending; treat completion_confidence as a signal, not a guarantee, and review transcripts for anything time-sensitive