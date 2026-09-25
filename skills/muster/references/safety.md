# Safety & Telephony Contract

Muster places automated outbound verification calls. In accordance with responsible agent practices and telecom regulations, any use of the live calling path must adhere to this safety contract:

1. **Authorized E.164 Recipients Only**:
   - Only audit numbers published in verified public directories (e.g. state provider registries, public marketplace seller contacts) or numbers you are explicitly authorized to verify.
   - All numbers must be valid E.164 formatted telephone numbers.

2. **Per-Run Human Preview & Approval**:
   - Live calling requires explicit per-run operator consent. In the CLI, users must interactively confirm the target count and estimated spend, or supply --confirm-live. In the web ledger, users must click through an explicit modal credit-guard.
   - Batch runs cannot be triggered automatically without human authorization.

3. **Privacy Masking in Summaries & Logs**:
   - Telephone numbers in UI ledgers, terminal telemetry, and public reports are masked (e.g., +1 (555) •••-••01) to prevent inadvertent disclosure of private or direct phone numbers.

4. **No Automatic Retry After Ambiguity**:
   - If a call encounters an ambiguous answer, an IVR hold loop, or a premature disconnection, Muster records the outcome as UNCERTAIN and halts re-dialing. It never repeatedly harasses front desks with automated re-dials.

5. **Honest Cancellation Limits & Metering**:
   - CALL-E call usage is measured in 10-second increments. Total cost includes a Call Fee and, when the task's defined business goal is achieved, a Success Fee. Preparation and pre-connection costs may apply even when a call does not connect; see the [pricing FAQ](https://www.heycall-e.com/).
   - Cancelling local work does not confirm that an already-submitted call has ended. Check its terminal result and [Dashboard billing](https://dashboard.heycall-e.com/account/billing); do not assume charges stop at a minute boundary.

6. **Mock-First Scope**:
   - The default mode is mock (zero telephony spend, zero network traffic). We strongly recommend using mock mode for all CI testing, demonstrations, and agent workflow rehearsals. Live mode is strictly experimental.

7. **Benign Non-Invasive Scope**:
   - Muster asks only ONE non-invasive question: whether the entity is in-network and accepting new patients/inquiries. It strictly never collects protected health information (PHI), payment details, or personal customer data.
