# Callsweep

Call many local businesses, haggle each one down toward your budget, rank their offers by the best overall deal, and book the one you pick. Built on CALL-E.

Full project and demo: https://github.com/rushibhosalepro/callsweep

## Run it (dry-run, no keys, no calls)

```bash
bun install
bun run src/index.ts "haircut under 40"
```

By default the app runs in mock mode: it shows the live board, ranks by best deal, and asks you which one to book, using the fictional sample shops in `fixtures/vendors.json`. No keys, no phone calls, no cost.

## How CALL-E is used

Two kinds of CALL-E phone call, each using `createAndWait` with a `recipientResultSchema` to pull back a structured result:

1. **Quote and haggle**: one call per shop. It asks their price, then, if you gave a budget, pushes them to do better and reports the negotiated final price.
2. **Book**: a call to the shop you pick, naming the service, the date, and the customer, to confirm the booking.

CALL-E runs each call on a fixed goal, so the negotiation is scripted into the quote call itself (ask price, then haggle toward the budget). The final booking is never automatic, you choose which shop before any booking call is placed.

## Real calls (optional)

Copy `.env.example` to `.env` and add `CALLE_API_KEY` (and `GROQ_API_KEY` for plain-English requests).

Real calls only dial numbers you explicitly authorize. Put the SAME valid E.164 number in both `ALLOWED_PHONES` (the authorized-recipient allowlist) and `TEST_PHONES`. Use your OWN number in place of the example below:

```bash
ALLOWED_PHONES="+14155550100" MOCK=false TEST_PHONES="+14155550100" bun run src/index.ts "haircut under 40"
```

The app refuses to dial any number that is not strict E.164 and on `ALLOWED_PHONES`, then asks for a `yes` at the prompt before placing a call.

## Safety

- Real calls only dial numbers on `ALLOWED_PHONES`: a destination must be a valid E.164 number that you have explicitly authorized before it can be called. `TEST_PHONES` alone is refused.
- Nothing is booked until you pick a shop; the booking call only goes to your choice.
- Sample data uses fictional numbers (`+1 555-01xx`). No real numbers or secrets in this folder.
- Discloses it is an automated assistant, and only ever negotiates against a real budget, never a fabricated competing quote.
- Not for medical, legal, financial, or emergency calls.
