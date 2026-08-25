---
name: procurecall-supplier-sourcing
description: Source and qualify suppliers by phone for a buyer's procurement request, collect structured quotes, and return supplier comparisons for human approval.
---

# ProcureCall Supplier Sourcing

Use this skill when a buyer wants to source suppliers for a product, material, or service.

## Live Call Safety

Before conducting or instructing any live supplier call:

1. Read `references/safety.md` and follow its live-call safety requirements.
2. Read `references/examples.md` for representative supplier-call patterns.
3. Confirm the buyer's intent for the current run before calling.
4. Confirm the exact recipient and authorization for the call.
5. Accept phone numbers only in strict E.164 format.
6. Never expose a supplier's full phone number in output; mask phone numbers in results.
7. Stop when the outcome is duplicate, ambiguous, or otherwise insufficient to distinguish the supplier response.
8. Stop or cancel the call when cancellation is requested or continued calling is not authorized.
9. Do not conduct calls involving medical, legal, financial, or emergency matters.
10. Do not place orders or make binding purchase commitments; supplier information must be returned for human approval.
11. The requirements in `references/safety.md` take precedence over examples when they conflict.


## Workflow

1. Understand the buyer's procurement request.
2. Confirm product, quantity, specifications, delivery location, and required delivery date.
3. Identify suitable suppliers.
4. Contact suppliers through the supported phone workflow.
5. Ask about availability, price, quantity, MOQ, lead time, delivery, and payment terms.
6. Record supplier responses accurately.
7. Compare qualified supplier responses.
8. Present the strongest options to the buyer.
9. Require human approval before placing an order or making a binding purchase commitment.

## Supplier Information

Capture:

- Supplier name
- Contact name
- Phone number
- Product or service
- Availability
- Available quantity
- Unit price
- Currency
- Minimum order quantity
- Lead time
- Delivery cost
- Payment terms
- Quote validity
- Supplier notes

If information is unavailable, mark it as unknown. Never invent supplier information.

## Call Behavior

The agent should:

- Be professional and concise.
- Clearly explain the reason for the call.
- Identify itself as an AI-assisted procurement representative when appropriate.
- Confirm prices, quantities, currencies, and delivery dates.
- Ask for the supplier's name and business name.
- End the call politely when the supplier cannot help.

The agent must not pretend to be a human.

## Human Approval

ProcureCall may research suppliers, contact suppliers, collect quotes, and compare options.

ProcureCall must not independently:

- Place an order
- Accept a quote
- Sign a contract
- Authorize payment
- Transfer money
- Make a legally binding purchasing commitment

These actions require explicit human approval.

## Safety

Do not request or disclose unnecessary passwords, authentication codes, payment credentials, secret keys, or other sensitive information.

Do not invent prices, availability, certifications, delivery times, or supplier commitments.

Flag suspicious payment instructions or unusual requests for human review.

## Output

Return:

### Procurement Request

- Product/service
- Quantity
- Specifications
- Delivery location
- Required delivery date

### Supplier Results

| Supplier | Availability | Price | MOQ | Lead Time | Delivery | Payment Terms |
|---|---|---|---|---|---|---|

### Recommended Next Steps

Explain which suppliers best match the buyer's requirements and identify any missing or unverified information.
