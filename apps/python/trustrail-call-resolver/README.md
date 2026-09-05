# TrustRail Call Resolver

TrustRail is a consent-gated Python web app for resolving invoice and purchase-order exceptions by phone. It extracts and reconciles fictional demo documents, preserves a human release/hold gate, and uses CALL-E only to collect bounded clarification facts.

Maintained source and runnable demo: https://github.com/northstar-trustrail/trustrail-call-resolver

## Safety and side effects

- Fixture mode places no call and is the default path without credentials.
- A real call requires a reviewed plan, positive recipient consent, and a separate execution action.
- Phone numbers are masked in browser responses; transcripts remain provider-side.
- The workflow refuses bank/routing/card data, tax identifiers, passwords, authentication codes, payment authorization, and automated payment release.
- Unknown, refusal, voicemail, and low-confidence outcomes route to human review and never become payment approval.

## Setup

See the maintained repository README for Python setup, CALL-E OAuth/API configuration, the six-test safety suite, and reproducible fictional PDF fixtures.
