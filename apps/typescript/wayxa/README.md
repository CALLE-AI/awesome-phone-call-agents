# WAYXA

**Where voice becomes action.**

WAYXA is an author-reported video showcase of a transaction layer for CALL-E
phone agents. This directory contains documentation only, not runnable application
source. No public source or reproducible setup is supplied with this contribution;
the described implementation and guarantees have not been independently verified.

## What it demonstrates

The author describes the following service-booking flow in the video:

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

In the demonstrated design, CALL-E supplies conversation results and WAYXA is
intended to control pricing, availability, authorization, payment verification,
booking, and transaction state.

## Safety and side effects

The author reports the following intended boundaries; this video-only reference
does not independently establish that they hold in an executable deployment:

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

The author describes the video as a real CALL-E conversation progressing through
customer intent, pricing and scheduling, Stripe Test Mode payment verification,
and a confirmed appointment. Watching the video is the no-call evaluation path;
this repository provides no call or payment execution instructions.

## Technology

- CALL-E
- Next.js
- React
- TypeScript
- Node.js
- Stripe

## Hackathon

Built for **CALL-E: Your Code Is Calling**.

WAYXA illustrates a proposed separation between conversational intent and
transaction approval. Treat it as an external hackathon case study, not a
certified payment or booking system.
