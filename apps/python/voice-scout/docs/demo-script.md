# Three-minute demo script

## 0:00–0:20 — Problem

Small businesses lose opportunities when nobody can answer the phone. Voice Scout turns the repetitive first qualification call into a reviewable workflow without pretending to be a human salesperson.

## 0:20–0:45 — Preview

Open the synthetic lead and run:

```bash
python app.py --demo
```

Point out that preview mode shows the destination and idempotency key but places no call.

## 0:45–1:20 — CALL-E execution

Show the explicit live-call boundary and submit one authorized test call with `--live`. Explain that the published CALL-E Goal owns the conversation behavior while Voice Scout supplies business context.

## 1:20–2:10 — Result

Show the returned structured result: interest, decision-maker status, company size, current workflow, pain points, and follow-up recommendation.

## 2:10–2:40 — Handoff

Explain that the JSON result can be sent to any CRM or human follow-up queue. The app is not tied to a cybersecurity CRM; cybersecurity is only one possible use case.

## 2:40–3:00 — Safety

Show the README's safety notes: preview by default, one authorized test lead first, stable idempotency keys, transparent AI disclosure, and no automatic promises or batch dialing.
