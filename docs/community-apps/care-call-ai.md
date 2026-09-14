# Care Call AI

Care Call AI is a practical support outreach and fulfilment coordination
workflow for charities and support organizations. It helps coordinators run
approved CALL-E check-ins with beneficiaries and turn explicit everyday needs
into human-reviewed support requests and printable handoff sheets.

- Repository: [https://github.com/NeoSPU/care-call-ai](https://github.com/NeoSPU/care-call-ai)
- Live application: [https://care.alexraixon.com](https://care.alexraixon.com)
- Project landing: [https://about.care.alexraixon.com](https://about.care.alexraixon.com)
- Demo video: [https://youtu.be/Hc2bWjTnKFQ](https://youtu.be/Hc2bWjTnKFQ)

The live application is deployed separately. The public repository is a
sanitized, runnable hackathon edition with fictional seed data, automated
tests, and the guarded CALL-E execution path.

## Overview

The coordinator reviews contact suitability, consent context, accessibility
preferences, blocked cases, and practical-support context before preparing an
outreach round. No-call preflight displays the selected recipients and blocked
reasons without placing calls. A live batch requires explicit operator
approval. Completed conversations become reviewable practical-support requests
rather than automatic fulfilment commitments.

Medication support means pickup or delivery logistics for an existing medicine
or prescription. Care Call AI does not prescribe, recommend dosages, monitor
adherence, or provide treatment advice.

## Setup

Requirements: Python 3.9 or later, Node.js 20 or later, npm, Docker, and Docker
Compose.

```bash
git clone https://github.com/NeoSPU/care-call-ai.git
cd care-call-ai
cp .env.example .env.local
make demo-up
make demo-smoke
npm --prefix frontend install
npm --prefix frontend run dev
```

Open `http://localhost:3000`. The repository README contains the local demo
credentials and the complete environment-variable reference.

## CALL-E integration method

The Python backend calls the official CALL-E Developer API over HTTPS. The
CALL-E access key remains in the backend environment. Browser requests use
same-origin Next.js routes, and the browser never receives CALL-E or backend
credentials.

## Safe testing path with no calls

The committed defaults disable live calls and limit a live batch to one
recipient if an operator later enables it. Tests use fake CALL-E runners. Run:

```bash
make test
```

The gate scans tracked files for secrets, runs backend and frontend tests, and
builds the production frontend. `/dashboard/preflight` is the inspection path;
it reports zero real calls before approval.

## Call side effects

A fully enabled and approved live run can ring a real phone, use CALL-E credits,
store a call outcome, and prepare a support request for coordinator review. It
does not itself provide or guarantee the underlying food, transport, home help,
companionship, or other service.

Live submission requires provider readiness, the backend live-call flag, an
eligible consented recipient, a current preflight approval, confirmation
checkboxes, and the exact authorization phrase shown by the application.

## Cancellation and duplicate-call protections

- Before submission, leave the approval flow or withhold the authorization
  phrase to cancel without placing a call.
- After provider submission, use provider controls when available; do not retry
  an ambiguous outcome until a human reconciles its status.
- Stable idempotency keys, repeat-call checks, daily limits, and a maximum batch
  size of one reduce duplicate or unintended calls.
- The application creates no hidden recurring schedule.

## Credential and data handling

- `.env.example` contains placeholders only; `.env` files are ignored.
- Real phone numbers and participant records must not be committed.
- Operator-facing previews mask phone numbers.
- Backend, CALL-E, assistant, and support-delivery tokens remain server-side.
- The public demo uses fictional beneficiaries and reserved example numbers.

## Boundaries

Care Call AI is not a medical, healthcare, clinical, patient-care, or
emergency-response product. It does not replace clinicians, carers, support
workers, emergency services, or human coordinators. Identity uncertainty,
distress, immediate danger, unsafe or prohibited requests, and medical, legal,
financial, password, banking, or identity questions stop automated intake and
route the matter to human review under the organization's own procedures.
