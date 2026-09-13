---
name: partline-part-sourcing
description: Safely source an exact industrial replacement part by calling approved suppliers with CALL-E and returning an evidence-backed comparison for human purchase approval.
---

# PartLine

Use this skill when a maintenance or procurement user needs current supplier facts that are best confirmed by phone: exact part identity, on-hand quantity, shipping cutoff, lead time and explicitly confirmed alternatives.

## Required inputs

Collect all of the following before creating a preview:

- requester and facility
- sourcing request ID
- exact manufacturer and part number
- quantity and need-by timestamp
- non-negotiable physical or electrical specifications
- whether alternatives may be discussed
- one to five supplier phone numbers in E.164 format
- region, locale and a purpose-bound authorization reference for every contact
- the suppliers' local timezone and weekday calling window

Do not infer missing specifications. Do not search for personal phone numbers. Use business contacts provided or approved by the user.

## Workflow

1. Write the request to a JSON file matching `assets/example-request.json`.
2. Run `partline preview REQUEST.json`.
3. Show the masked recipients, call count, exact task, purchase boundary and approval token.
4. Pause for explicit user approval. A request to preview is not approval to call.
5. Only after explicit approval, run the exact command printed by preview.
6. Poll the returned call ID. Never create a second task because polling timed out.
7. Rank exact matches before compatible matches. Mark unknown, contradictory or unsupported results for human follow-up.
8. Present evidence and caveats. Never purchase, reserve, negotiate or accept supplier terms.

## Safety rules

- Preview by default.
- Never pass `--live` without explicit approval in the current conversation.
- Never call outside the configured weekday call window.
- Never include another supplier's name, quote or inventory in a call.
- Never claim compatibility unless the supplier confirms every required specification.
- Treat a proposed alternate as requiring engineering approval.
- Do not persist raw transcripts unless the user provides a retention purpose and location.
- A CALL-E result supplies research evidence, not purchasing authority.

## Useful commands

The reference implementation lives in [`apps/python/partline`](../../apps/python/partline/).

```bash
cd apps/python/partline
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

partline preview fixtures/example-request.json
partline summarize fixtures/completed-call.json --request fixtures/example-request.json
```

`preview` never places a call. It prints masked recipients, the call count and an
approval token that is bound to that exact request. A live run additionally
requires `--live`, the matching token and an open weekday call window.

