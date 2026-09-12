# Safety

Muster places outbound verification calls, so treat it like any tool that dials real people.

- One benign question per call. Muster only asks whether a listing is active, in-network, and accepting patients. It never asks for health details, payments, account numbers, or any personal information.
- Scope and consent. Only audit directories you have a legitimate reason to check, and only call numbers a business publishes for contact or verification.
- Identify the call. The agent introduces itself as a directory verification check.
- Rate limits. Keep concurrency low (default 2) to respect front desks and phone gateways.
- Cost and delivery. Live calls are metered by duration and can be billed even when a call does not connect. Use mock mode for development and demos.
- Data. Keep only what the audit needs: the verdict, confidence, the cited quote, and the transcript.
