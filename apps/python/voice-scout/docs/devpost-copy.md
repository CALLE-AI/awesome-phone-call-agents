# Devpost submission copy

## Title

Voice Scout - AI Phone Qualification for Small-Business

## Short description

Voice Scout uses CALL-E to qualify business leads by phone, return structured discovery results, and hand the next step to a human. It is configurable for different industries instead of being tied to one CRM or vertical.

## Longer description

Small businesses lose opportunities when nobody can answer the phone or when the first qualification conversation never gets recorded. Voice Scout turns that repetitive first conversation into a safe, reviewable workflow.

A lead is loaded from a CRM export or JSON file. Voice Scout previews the destination and context before any call is placed. After explicit approval, it submits one CALL-E Goal Run with a stable idempotency key, passes the business context, polls for completion, and returns a structured result. The result includes interest level, decision-maker status, company size, current workflow, pain points, and whether human follow-up is appropriate.

The application is intentionally business-agnostic. Cybersecurity is one example application, but the same workflow can qualify leads for websites, managed IT, insurance, staffing, consulting, home services, and other business services by changing the published CALL-E Goal.

Voice Scout is designed to assist a human salesperson, not replace one. It identifies itself as automated, asks permission to continue, handles gatekeepers and voicemail, defaults to preview mode, uses one authorized test lead before real outreach, and avoids promises about pricing, insurance, eligibility, or outcomes.

## How CALL-E is used

CALL-E provides the phone conversation and Goal Run execution. Voice Scout provides the lead context, approval boundary, idempotency protection, polling, and structured handoff.

## Built with

- Python
- CALL-E Python SDK (`calle-ai`)
- Published CALL-E Goals
- JSON lead/CRM handoff

## Demo

The demo shows preview mode, one explicit CALL-E test run, the structured result, and the handoff to a human follow-up queue.

## Future work

- Native adapters for common CRM exports
- Team-level approval and contact policies
- Consent and suppression-list integrations
- Webhook-based result delivery
