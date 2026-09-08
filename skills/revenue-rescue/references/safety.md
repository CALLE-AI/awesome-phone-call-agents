# Safety & Compliance Reference: Revenue Rescue

This document outlines the strict safety, consent, and compliance boundaries enforced by the **Revenue Rescue** skill. Because this workflow interacts with customers regarding financial exceptions (failed payments), it operates under the highest tier of safety constraints to prevent real-world harm, financial fraud, or customer harassment.

## 1. Financial & PCI/PII Boundaries (Strict)
The Revenue Rescue agent is strictly prohibited from collecting, processing, or storing sensitive financial or personal data over the phone.

* **No Payment Details:** The agent must **never** ask for, accept, or repeat credit card numbers, CVVs, expiration dates, bank account numbers, or routing numbers.
* **No Credentials:** The agent must **never** ask for passwords, PINs, or multi-factor authentication (MFA) codes.
* **No PII:** The agent must not ask for or confirm Social Security Numbers (SSNs), full dates of birth, or physical addresses unless strictly required for identity verification by a human agent.
* **Redirect Protocol:** If a customer attempts to provide a credit card number or sensitive data during the call, the agent must politely interrupt, state that it cannot accept payment details over the phone, and direct the customer to the secure link provided in their email or the official billing portal.

## 2. Consent & Disclosure
* **AI Disclosure:** The agent must clearly identify itself as an automated assistant calling on behalf of [Company] at the beginning of the conversation.
* **Purpose Disclosure:** The agent must explicitly state the reason for the call (e.g., "We are calling regarding a failed payment on your account").
* **Opt-Out:** If the customer explicitly asks to be removed from the call list or states they do not wish to be contacted by phone, the agent must immediately acknowledge the request, end the call politely, and flag the record in the CRM to suppress future automated calls.

## 3. Idempotency & Duplicate Prevention
To prevent customer harassment and operational errors, the skill enforces strict idempotency:
* **Key Generation:** Every call attempt generates a unique idempotency key derived from a SHA-256 hash of `customer_id` + `trigger_id` + `attempt_number`.
* **Deduplication:** The system checks this key against the database before placing a call. If a successful call or a "payment promised" outcome already exists for this specific trigger, the call is aborted.
* **Retry Limits:** The automated retry cascade is strictly limited to a maximum of 3 attempts. After 3 failed attempts (e.g., no answer, voicemail), the workflow halts and escalates to human review.

## 4. Quiet Hours & Regional Compliance
* **Timezone Awareness:** The Decision Engine evaluates the customer's local timezone. Calls are strictly blocked outside of the safe calling window (08:00 to 21:00 local time).
* **Queueing:** If a trigger occurs outside of safe calling hours, the task is queued and scheduled for the next valid window.
* **Unsupported Regions:** If the CALL-E platform reports that a destination number is in an unsupported region, the skill immediately fails-closed, cancels the call, and routes the exception to a human agent via email or ticketing system.

## 5. Ambiguous Outcome Handling (Fail-Closed)
In phone workflows, ambiguity must never be treated as success.
* **No Answer / Voicemail:** If the call is not answered, or a voicemail is reached, the outcome is strictly classified as `no_answer`. The agent leaves a brief, non-sensitive message (if permitted) and schedules a retry. It **never** assumes the customer received the message.
* **Dropped Calls:** If the call disconnects before a clear outcome is reached, the outcome is classified as `failed`. The system does not assume the customer agreed to any terms.
* **Human Escalation:** Any outcome classified as `unknown`, `failed`, or `disputed` automatically triggers a fail-closed disposition, creating a ticket for human reconciliation rather than attempting further automated resolution.

## 6. Cancellation & Rollback
* **Pre-Call Cancellation:** If the customer resolves the issue (e.g., updates their payment method via the secure email link) *before* the scheduled CALL-E execution, the webhook listener must detect the status change and immediately cancel the pending CALL-E task to save credits and prevent redundant calls.
* **Mid-Call Cancellation:** If the customer states they have already resolved the issue during the call, the agent must acknowledge this, verify the account status if possible (or trust the user's statement to avoid friction), and immediately terminate the call gracefully without leaving a voicemail.