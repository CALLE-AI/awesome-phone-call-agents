# Atenea Call — Last Mile Delivery Assistant

Atenea Call is a last-mile delivery exception-resolution demo built for the CALL-E Hackathon 2026.

## What it does

The app helps handle delivery exceptions by:

- selecting a delivery order and operational scenario
- verifying identity before sensitive actions
- applying order-specific permissions and restrictions
- orchestrating primary and secondary contact attempts
- guiding customers and couriers toward authorized outcomes
- escalating when the requested action is not permitted
- preserving an auditable interaction trace

## CALL-E integration

The project integrates CALL-E for real outbound phone-call execution.

A real CALL-E integration was demonstrated during development. The final validation from the updated interface was affected by CALL-E issue #229, involving MCP tools/call timeouts during call execution.

## Safety and side effects

Real-call mode can place outbound phone calls and therefore has real-world side effects.

- Use only authorized recipient numbers.
- Do not include credentials, tokens, or personal data in shared logs.
- Test scenarios use fictional delivery data.
- The simulator can be inspected without requiring a live call.
- Live-call execution should only be used when explicitly authorized.

## Credentials

CALL-E authentication is handled outside the repository configuration and credentials must not be committed.

## Preview / dry-run behavior

The interface includes fictional delivery scenarios that allow the operational workflow, decision logic, escalation states, and monitoring UI to be reviewed without relying on a successful live call.

## Demo

The hackathon submission includes a video demonstration and an externally accessible simulator interface.

## Built with

- Node.js
- JavaScript
- CALL-E CLI / MCP
- HTML / CSS
- JSON-based orchestration and trace data
