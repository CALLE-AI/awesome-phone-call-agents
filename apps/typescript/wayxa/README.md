# WAYXA

**Where voice becomes action.**

WAYXA is a transaction layer for autonomous phone agents that turns structured CALL-E conversation results into deterministic, auditable business actions.

## What it demonstrates

The demo implements an end-to-end service booking workflow:

1. CALL-E conducts the phone conversation.
2. CALL-E returns structured customer intent.
3. WAYXA identifies the requested service.
4. WAYXA generates the authoritative price.
5. WAYXA checks availability and temporarily reserves an appointment.
6. Customer authorization is recorded.
7. Stripe Checkout collects the deposit in Test Mode.
8. WAYXA independently verifies payment with Stripe.
9. The appointment is committed.
10. WAYXA produces an auditable completed transaction.

The core design principle is:

> **Conversation is probabilistic. Transaction state is deterministic.**

CALL-E owns the conversation and intent extraction. WAYXA remains authoritative for pricing, availability, authorization, payment verification, booking, and transaction state.

## Safety and side effects

WAYXA intentionally separates conversational output from transactional authority.

- A CALL-E result cannot mark a payment as successful.
- A browser redirect from Stripe is not treated as payment proof.
- Payment must be independently verified with Stripe before booking is committed.
- Price and availability come from deterministic application logic.
- Transaction state transitions are controlled by WAYXA.
- The hackathon payment flow uses Stripe Test Mode only.
- Live phone calls require an authorized CALL-E configuration.

## Demo

Video:

https://youtu.be/6912In2LtKE

The submitted demo shows a real CALL-E conversation progressing through customer intent, deterministic pricing and scheduling, Stripe Test Mode payment verification, and a confirmed appointment.

## Technology

- CALL-E
- Next.js
- React
- TypeScript
- Node.js
- Stripe

## Hackathon

Built for **CALL-E: Your Code Is Calling**.

WAYXA demonstrates how autonomous phone agents can safely move beyond conversation into verified real-world commitments.
