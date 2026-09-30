# Jalolink case study

The public Conversact reference is informed by a private Jalolink integration but does not include Jalolink source code or require Jalolink services.

Conceptually, the private deployment follows this flow:

```text
Telegram → verified phone share → one-use consent → CALL-E ordering conversation
→ Jalolink authoritative catalog quote and confirmation → Paystack test-mode checkout
→ verified reconciliation → receipt image → Telegram
```

The reusable public contribution is the smaller middle: explicit authorization, one bounded call, untrusted structured purchase evidence, deterministic validation, and a checkout handoff. The demo substitutes local `DemoCommerce` and `DemoPayment` adapters for Jalolink and Paystack.

The private deployment reportedly has 99+ automated tests. That is author-reported evidence and is not independently verified by this repository or required to run this reference app.
