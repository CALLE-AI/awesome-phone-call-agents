# Architecture

```text
Explicit authorization
        |
        v
Conversact workflow session -- stable idempotency --> CALL-E
        |                                             |
        |                                      structured evidence
        v                                             v
Result policy <-------------------------------- terminal result
        |
        +-- declined, opt-out, absent/ambiguous result --> stop
        |
        v
DemoCommerce / CommercePort -- authoritative catalog, stock, prices --> quote
        |
        v
DemoPayment / PaymentPort -- synthetic only --> checkout handoff
```

CALL-E is an untrusted conversational-evidence source. Its structured result must bind to the expected session and recipient, have terminal `completed` status, satisfy the expected schema, request an order, list items, and record `customer_confirmed: yes` before the commerce port runs.

The commerce port alone decides product identity, availability, unit prices, delivery cost, and total. CALL-E money fields are absent from the result contract and ignored even if conversational text mentions an amount.

An ambiguous provider create outcome stops at `CALL_AMBIGUOUS`. It is not treated as a failed call that can be automatically re-created.
