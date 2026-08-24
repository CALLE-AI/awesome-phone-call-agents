# Examples — procurecall-supplier-sourcing

Worked examples of supplier-sourcing calls and the structured information
ProcureCall should return. All suppliers, names, phone numbers, prices,
and business details in these examples are fictional fixtures.

## 1. Supplier has the requested product

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative
       calling on behalf of a buyer. I'm calling to check availability for
       500 bags of 50kg cement. Do you currently have that quantity available?

Supplier: Yes, we have about 800 bags available.

Agent: What is your current price per bag?

Supplier: ₦12,500 per bag.

Agent: And how soon could you deliver 500 bags to Abuja?

Supplier: We can deliver within two business days.

Expected supplier result:

```json
{
  "supplier": "Example Building Supplies",
  "availability": "available",
  "available_quantity": "800 bags",
  "unit_price": "₦12,500",
  "currency": "NGN",
  "minimum_order_quantity": "unknown",
  "lead_time": "2 business days",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier stated that approximately 800 bags are currently available."
}
```

## 2. Supplier has insufficient quantity

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative
       calling on behalf of a buyer. We are looking for 1,000 cartons of
       packaged bottled water. How many cartons do you currently have?

Supplier: We have about 400 cartons available.

Agent: Can you supply the full 1,000 cartons within five business days?

Supplier: No. We can only supply the 400 cartons we currently have.

Expected supplier result:

```json
{
  "supplier": "Example Water Distribution",
  "availability": "partially_available",
  "available_quantity": "400 cartons",
  "unit_price": "unknown",
  "currency": "unknown",
  "minimum_order_quantity": "unknown",
  "lead_time": "unknown",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier can provide approximately 400 cartons but cannot supply the requested 1,000 cartons."
}
```

## 3. Supplier does not have the requested product

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative.
       I'm calling to check whether you can supply 200 office chairs.

Supplier: We don't stock office chairs. We only supply office desks and
          filing cabinets.

Expected supplier result:

```json
{
  "supplier": "Example Office Traders",
  "availability": "unavailable",
  "available_quantity": "unknown",
  "unit_price": "unknown",
  "currency": "unknown",
  "minimum_order_quantity": "unknown",
  "lead_time": "unknown",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier stated that office chairs are not stocked."
}
```

## 4. Supplier provides price but delivery information is unknown

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative.
       We are sourcing 300 units of industrial LED floodlights. Are they
       currently available?

Supplier: Yes, we have them available.

Agent: What is the price per unit?

Supplier: ₦38,000 each.

Agent: What is your delivery time to Abuja?

Supplier: I would need to confirm that with our logistics team.

Expected supplier result:

```json
{
  "supplier": "Example Industrial Lighting",
  "availability": "available",
  "available_quantity": "unknown",
  "unit_price": "₦38,000",
  "currency": "NGN",
  "minimum_order_quantity": "unknown",
  "lead_time": "unknown",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier confirmed availability and unit price but could not confirm delivery timing during the call."
}
```

## 5. Supplier gives MOQ and payment terms

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative.
       We need 2,000 pieces of branded paper bags. Can you supply them?

Supplier: Yes. Our minimum order is 1,000 pieces.

Agent: What is your price per piece?

Supplier: ₦180 per piece.

Agent: What are your payment terms?

Supplier: We require 70 percent upfront and the remaining 30 percent before
          dispatch.

Agent: How long does production take?

Supplier: Seven business days after artwork approval.

Expected supplier result:

```json
{
  "supplier": "Example Packaging Works",
  "availability": "available",
  "available_quantity": "unknown",
  "unit_price": "₦180",
  "currency": "NGN",
  "minimum_order_quantity": "1,000 pieces",
  "lead_time": "7 business days after artwork approval",
  "delivery_cost": "unknown",
  "payment_terms": "70% upfront; 30% before dispatch",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier stated that production begins after artwork approval."
}
```

## 6. Supplier gives a quote validity period

Input call transcript:

Agent: Hello, this is ProcureCall calling on behalf of a buyer. We are
       requesting 100 units of a commercial generator. Are they available?

Supplier: Yes. The current price is ₦4,800,000 per unit.

Agent: How long is that quoted price valid?

Supplier: The quote is valid for seven days.

Agent: Can you confirm the delivery time?

Supplier: Three business days after payment confirmation.

Expected supplier result:

```json
{
  "supplier": "Example Power Equipment",
  "availability": "available",
  "available_quantity": "unknown",
  "unit_price": "₦4,800,000",
  "currency": "NGN",
  "minimum_order_quantity": "unknown",
  "lead_time": "3 business days after payment confirmation",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "7 days",
  "supplier_notes": "Quoted price was stated to be valid for seven days."
}
```

## 7. Supplier information is ambiguous

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative.
       We are looking for 750 bags of rice. Can you supply that quantity?

Supplier: We should have enough.

Agent: Can you confirm the exact quantity available?

Supplier: I can't confirm the exact number right now.

Agent: What is the current price per bag?

Supplier: Around ₦95,000, but I would need to check.

Expected supplier result:

```json
{
  "supplier": "Example Food Supply",
  "availability": "unknown",
  "available_quantity": "unknown",
  "unit_price": "unknown",
  "currency": "NGN",
  "minimum_order_quantity": "unknown",
  "lead_time": "unknown",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier could not confirm exact availability or price. No unverified value should be treated as a quote."
}
```

## 8. Supplier cannot help

Input call transcript:

Agent: Hello, this is ProcureCall, an AI-assisted procurement representative.
       We are looking for 50 tonnes of structural steel.

Supplier: We don't handle structural steel.

Agent: Is there another supplier or business unit you can refer us to?

Supplier: No, unfortunately.

Expected supplier result:

```json
{
  "supplier": "Example General Trading",
  "availability": "unavailable",
  "available_quantity": "unknown",
  "unit_price": "unknown",
  "currency": "unknown",
  "minimum_order_quantity": "unknown",
  "lead_time": "unknown",
  "delivery_cost": "unknown",
  "payment_terms": "unknown",
  "quote_validity": "unknown",
  "supplier_notes": "Supplier stated that it does not handle structural steel and could not provide a referral."
}
```

## 9. Human approval is required before purchase

Input call transcript:

Agent: We have compared the supplier responses and this supplier appears
       to be the strongest match.

Buyer: Go ahead and purchase the materials.

Expected handling:

ProcureCall must not independently place the order, accept the quote,
sign a contract, authorize payment, transfer money, or make a legally
binding purchasing commitment.

Expected result:

```json
{
  "status": "human_approval_required",
  "reason": "Supplier comparison may be presented to the buyer, but purchase commitments require explicit human approval.",
  "allowed_actions": [
    "present_supplier_comparison",
    "identify_missing_information",
    "request_human_approval"
  ],
  "prohibited_actions": [
    "place_order",
    "accept_quote",
    "sign_contract",
    "authorize_payment",
    "transfer_money",
    "make_binding_purchase_commitment"
  ]
}
```

## 10. Safety and unknown information

If a supplier does not provide a field, ProcureCall must return `unknown`
rather than inventing a value.

ProcureCall must not invent:

- prices
- availability
- available quantities
- certifications
- delivery times
- delivery costs
- payment terms
- quote validity
- supplier commitments

ProcureCall should flag suspicious payment instructions or unusual requests
for human review.

ProcureCall should not request or disclose unnecessary:

- passwords
- authentication codes
- payment credentials
- secret keys
- other sensitive information

## 11. Supplier comparison example

Buyer request:

- Product: 50kg cement
- Quantity: 500 bags
- Delivery location: Abuja
- Required delivery date: within 5 business days

Supplier responses:

```text
| Supplier                    | Availability       | Price      | MOQ     | Lead Time       | Delivery      | Payment Terms |
|----------------------------|--------------------|------------|---------|-----------------|---------------|---------------|
| Example Building Supplies  | available          | ₦12,500    | unknown | 2 business days | unknown       | unknown       |
| Example Materials Depot    | available          | ₦12,900    | 200     | 3 business days | ₦180,000      | unknown       |
| Example Cement Traders     | partially_available| ₦12,300    | unknown | 6 business days | unknown       | unknown       |
```

Recommended next steps:

Explain which suppliers best match the buyer's requirements. Identify any
missing or unverified information. Do not place an order or make a binding
purchase commitment without explicit human approval.

## 12. Output contract

A normal supplier result should contain:

```json
{
  "supplier": "string",
  "availability": "available | partially_available | unavailable | unknown",
  "available_quantity": "string or unknown",
  "unit_price": "string or unknown",
  "currency": "string or unknown",
  "minimum_order_quantity": "string or unknown",
  "lead_time": "string or unknown",
  "delivery_cost": "string or unknown",
  "payment_terms": "string or unknown",
  "quote_validity": "string or unknown",
  "supplier_notes": "string"
}
```

When the transcript does not support a value, use `unknown`.

Never convert an approximate or uncertain supplier statement into a
confirmed fact.

All names, phone numbers, prices, companies, and business details in this
file are fictional fixtures for testing and documentation.