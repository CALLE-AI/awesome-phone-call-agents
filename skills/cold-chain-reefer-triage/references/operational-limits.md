# Operational Limits & Failure Modes

## 1. Accepted-Call vs Unverified-Driver Boundaries

- **Self-Attestation Limit**: When a call completes, the data collected reflects self-reported observations from the individual answering the phone. While the agent verifies driver identity by name at the start of the call, telephony audio alone does not cryptographically prove driver identity.
- **Ambiguous or Contradictory Answers**: If the driver provides conflicting responses (e.g., claiming the unit is humming while reporting an engine-off fault), the extraction confidence score is lowered. Downstream systems must treat low-confidence extractions (< 0.75) as untrusted and trigger human operator cross-examination.
- **Third-Party Pickups**: If a third party (such as a family member, lumpers at a dock, or voicemail) answers, the agent cannot complete the mechanical checklist. The call is marked as incomplete and flagged for human follow-up.

## 2. Network Drops, Unknown Outcomes & SIP 408 Timeouts

- **SIP 408 / Call Setup Timeouts**: In rural or poor-cellular corridors where long-haul commercial trucks frequently operate, telephony carriers may return SIP 408 (Request Timeout), SIP 486 (Busy Here), or SIP 503 (Service Unavailable).
- **In-Call Audio Dropouts**: If the cellular connection drops mid-call before the checklist finishes:
  - The call status is recorded as `failed` or `unknown`.
  - The Zero-Redial policy strictly forbids automated redial loops to prevent driver distraction while operating heavy vehicles.
  - Partial transcripts captured prior to disconnect are preserved in `evidence` for forensic dispatch review, but `task_completed` is set to `False`.
- **Unknown Outcome Reconciling**: When CALL-E reports an ambiguous status or network timeout, the system does not coerce a plausible answer. It immediately yields a failure payload to notify fleet dispatch.

## 3. Advisory Status & Fleet Operator Validation

- **Non-Actuating Nature**: This skill is an **advisory and experimental community agent skill**. It generates structured observation summaries and recommended action options (`selected_option`).
- **Fleet Manager Validation Mandatory**: Output recommendations must **never** be piped directly into mutating physical actuators (e.g. modifying Electronic Logging Device logs, triggering automated engine shutdowns, or committing carrier funds) without explicit authorization by a human fleet manager or logistics dispatcher.
- **Regulatory Responsibility**: Compliance with the Food Safety Modernization Act (FSMA) 21 CFR Sanitary Transportation Rule and FMCSA 49 CFR Part 395 Hours of Service remains the sole legal responsibility of the motor carrier and licensed driver.
