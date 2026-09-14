# Exception Broker

Exception Broker is an execution-control layer for operational decisions acquired through CALL-E.

- Public demo: https://exception-broker-production.up.railway.app
- Demo video: https://youtu.be/Smw7aXyI0fI
- Runtime: TypeScript, React, Node.js, Vite, Zod, Motion, and CALL-E.

Exception Broker is an externally hosted user-facing application. It is not a CALL-E SDK or a supported CALL-E API.

## Overview

CALL-E handles the real-world acquisition boundary: it can place an authorized phone call, capture the conversation, and return provider evidence and a structured result.

Exception Broker begins after acquisition.

It preserves the acquired evidence, requires exact review of the decision, and evaluates whether that reviewed decision may be applied within the available operational context.

The core distinction is:

**Decision acquired does not equal authority to execute.**

The Broker can return `ALLOW`, `BLOCK`, or `WAIT` without changing the underlying acquired decision.

## Safe no-call demonstration

The public application includes an **Interactive Demo** that requires no CALL-E account, API key, or outbound phone call.

The deterministic short-supply scenario demonstrates an `APPROVED` decision requiring 150 substitute units when only 100 are available. Client authorization is sufficient, but physical supply is not, so the Broker returns `BLOCK`.

No external ERP, WMS, CRM, customer, or order system is modified.

## Live CALL-E integration

The application also exposes two explicit live paths:

- **Hosted Sandbox** uses a server-controlled CALL-E integration against a configured synthetic testing destination.
- **Your CALL-E Account (BYOK)** lets a user connect their own CALL-E API key and provide a recipient they own or are authorized to call.

Live calls require explicit user confirmation before dispatch.

Provider outcomes are not scripted. Exception Broker evaluates the result CALL-E actually returns and does not infer a decision from transcript text when no usable structured result exists.

## Credential and recipient handling

Hosted CALL-E credentials remain server-side.

For BYOK, the user supplies their own CALL-E credential for the connection. Credentials are not rendered back into the product UI.

Recipients must be supplied in E.164 form and the user must confirm ownership or authorization before initiating a call.

## Ambiguous provider acceptance

A network or provider error does not necessarily prove that a call request was never received.

Exception Broker therefore preserves ambiguous acceptance instead of automatically creating a second independent call. Reconciliation reuses the same logical acquisition and stable idempotency identity.

This behavior is fail-closed: an uncertain acquisition does not create execution authority.

## Operational boundaries

The hackathon build evaluates application attempts against controlled local operational context.

It does not claim live ERP/WMS truth and does not perform external execution.

The deterministic walkthrough is intentionally separate from live CALL-E acquisition so judges can reproduce the execution-control behavior without consuming provider quota or placing a phone call.
