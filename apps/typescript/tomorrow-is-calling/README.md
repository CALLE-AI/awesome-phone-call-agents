# Tomorrow Is Calling

**Tomorrow Is Calling** is a CALL-E-powered vehicle transport workflow that turns a customer’s first shipping request into a structured quote, decision, payment handoff, and booking flow.

The project explores how an AI phone agent can reduce repetitive coordination work while keeping important business boundaries explicit: CALL-E can present confirmed transport information, explain approved pricing, record a customer decision, and trigger approved next steps, but it does not collect payment credentials or invent pricing.

## Hackathon

Built for **CALL-E — Your Code Is Calling**.

**Submission deadline:** September 14, 2026 at 10:45 AM CDT.

## The problem

Vehicle transport requests often involve repeated phone calls, incomplete information, quote follow-ups, payment coordination, and handoffs between customers and staff.

A customer may provide only part of what is needed to price and book a shipment. Staff then have to confirm pickup and delivery locations, vehicle details, operability, service type, preferred dates, pricing, payment terms, and the customer’s final decision.

The result is a workflow that is easy to delay and difficult to scale consistently.

## The solution

Tomorrow Is Calling uses **CALL-E as the conversational layer** for the customer-facing quote workflow.

CALL-E can:

- present confirmed transport details;
- present an approved transport quote;
- explain the initial payment and remaining balance;
- record whether the customer accepts, declines, wants time, requests the quote by email, or raises a price objection;
- guide accepted customers toward a secure payment handoff; and
- return structured results to the staff console.

The application keeps business logic and sensitive operations outside the voice conversation.

## Customer flow

```text
Customer requests transport
        ↓
Transport details captured
        ↓
Request validated?
   ↙          ↘
 No            Yes
 ↓              ↓
Request       Quote engine
correction       ↓
   └──────→ Estimated quote
                  ↓
          Rate / quote confirmation
                  ↓
            Confirmed quote
                  ↓
          CALL-E presents quote
                  ↓
           Customer decision
      ↙       ↓       ↓        ↘
 Decline    Think    Email    Price issue
                               ↓
                           Human review

                 Accept
                   ↓
          Secure payment link
                   ↓
           Initial payment
                   ↓
                Booked
                   ↓
        Carrier assignment
                   ↓
                Pickup
                   ↓
              In transit
                   ↓
               Delivery
                   ↓
          Remaining payment
                   ↓
                Closed
```

## Demo scenario

The current prototype uses a sample transport quote:

- **Estimated range:** $1,050–$1,250
- **Confirmed transport price:** $1,180
- **Initial payment:** $590
- **Remaining balance:** $590 at delivery
- **Supported demo payment methods:** credit card, debit card, and ACH

The 50/50 payment split is a **demo-selected payment term**, not a claim that all vehicle transport companies use the same structure.

## Customer decision states

The quote workflow supports five customer outcomes:

| Customer response | System state | Next action |
| --- | --- | --- |
| Accept | `QUOTE_ACCEPTED` | Send secure payment link |
| Decline | `QUOTE_DECLINED` | Close or follow up later |
| Think about it | `QUOTE_PENDING_CUSTOMER` | Send or retain quote for review |
| Email the quote | `QUOTE_SENT` | Wait for customer response |
| Price is too high | `PRICE_OBJECTION` | Escalate for human review |

Only an **explicit quote acceptance** can continue to the payment step.

## Payment and safety boundary

CALL-E is intentionally separated from payment credential collection.

**CALL-E may:**

- present an approved price;
- explain payment terms;
- record quote acceptance;
- send or trigger a secure hosted payment link; and
- report the resulting workflow state.

**CALL-E does not:**

- ask the customer to speak a card number;
- store card or bank credentials;
- charge the customer directly during the call;
- invent discounts or negotiate below an approved price floor; or
- silently alter a confirmed transport price.

Payment credentials belong on a secure provider-hosted checkout page.

## Application workflow

The staff-facing prototype includes:

- transport request intake;
- customer and shipment details;
- quote summary;
- CALL-E call brief;
- customer decision states;
- secure-payment handoff state;
- structured call outcome and reporting; and
- operational next actions.

The interface is designed to make each state visible rather than hiding important transitions inside the conversation.

## Architecture

```text
Customer
   ↓
React + TypeScript client
   ↓
Transport / quote workflow
   ↓
Secure backend
   ├── CALL-E voice agent
   ├── Quote / business rules
   ├── CRM or job state
   └── Secure payment provider
             ↓
      Payment confirmation
             ↓
      Booking / dispatch state
```

A production version could connect services such as a payment processor, messaging provider, CRM, and carrier or dispatch systems.

Those integrations should remain isolated behind the backend rather than exposing credentials or privileged operations to the browser or voice agent.

## Technology stack

- **React**
- **TypeScript**
- **Vite**
- **Node.js**
- **CALL-E** for the phone-agent workflow

## Project structure

```text
client/             Vite React application
backend/            Server-side CALL-E integration
docs/               Hackathon, planning, and development documentation
tasks/              Backlog and sprint tracking
.env.example        Example environment configuration
README.md           Project documentation
```

## Local development

Install and run the frontend:

```bash
cd client
npm install
npm run dev
```

Run the backend from the project root:

```bash
node backend/server.mjs
```

Validation commands:

```bash
cd client
npm run lint
npm run build
```

## Environment variables

Use `.env.example` as the reference for local configuration.

Never commit real API keys, payment credentials, phone numbers, or other secrets to source control.

## Privacy

The project follows a minimum-data approach for phone and customer information.

Sensitive payment credentials are not part of the CALL-E conversation and should not be stored in application logs.

For a production deployment, phone-number retention, call recordings, transcripts, and customer data should be governed by explicit consent and a documented retention policy.

## Current status

The repository contains the working vehicle transport workflow UI, quote and payment state model, and CALL-E outbound calling through a server-side integration.

The CALL-E integration presents the confirmed quote, captures the customer’s decision, and returns structured quote-decision results to the staff-console workflow.

External carrier, CRM, payment, and production dispatch integrations may be represented with demo or test behavior unless explicitly connected.

## Why this matters

The goal is not to replace every human interaction in logistics. It is to give routine coordination work a reliable first layer while preserving human review where judgment or authorization matters.

**CALL-E handles the conversation. The application owns the rules. Humans remain available for exceptions.**

## Documentation

Additional planning and hackathon notes are available in [`docs/`](docs/).

## CALL-E Contribution Notes

### Live-call side effects

When CALL-E live calling is enabled, starting a call can place a real outbound phone call.

- Calls must be explicitly initiated by the user.
- Test recipients should be authorized to receive the call.
- Phone numbers should use E.164 format.
- The backend can restrict calls to an approved recipient allowlist.
- The application does not create hidden recurring calls or scheduled calling jobs.

### Safe testing

Reviewers can inspect the request, quote, CALL-E call brief, customer decision states, and resulting workflow without providing payment credentials.

Before placing a live CALL-E call:

1. Configure the CALL-E API key on the backend.
2. Configure an authorized test recipient.
3. Start the application.
4. Review the confirmed quote.
5. Explicitly start the CALL-E call.
6. Complete the test conversation.
7. Return to the application to review the structured result and next action.

CALL-E must never be given real card numbers, CVV values, bank-account credentials, or other payment credentials.

### CALL-E structured result

The CALL-E integration can return structured fields including:

- whether the customer was reached;
- whether identity was confirmed;
- whether the quote was presented;
- the customer's quote decision;
- the recommended next action;
- whether human help is required;
- customer questions;
- price-objection information;
- competitor pricing mentioned during the conversation; and
- a call summary.

These results allow the application to move through deterministic workflow states without giving the voice agent authority over pricing or payment processing.

### Human escalation

The workflow routes requests to a human when:

- the customer objects to the price;
- the customer requests a discount;
- a competitor price is mentioned;
- identity cannot be confirmed;
- the customer asks an unsupported policy question; or
- the customer’s decision is unclear.

## License

License to be determined.