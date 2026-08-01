---
name: accessproof
description: Prepare and run user-authorized CALL-E calls that ask public venues a fixed set of observable access questions, then return condition-level staff-reported evidence with explicit unknowns.
license: MIT
---

# AccessProof venue verification

Use this skill when a person wants an agent to call one to three public venues and ask exact, observable questions for a planned visit. It produces evidence for the person to interpret. It never certifies a venue or decides whether a venue is universally accessible.

## When to use

- Compare exact visit conditions across public venues.
- Ask a venue about a route, measurement, seating arrangement, communication option, sensory condition, or other observable fact.
- Recheck one unresolved condition with a separately authorized follow-up.
- Return staff-reported answers with source, time, uncertainty, and limitations.

## When not to use

- Do not call private or residential numbers.
- Do not infer a diagnosis or ask the user to disclose one.
- Do not request a certification, legal conclusion, or whole-venue accessibility verdict.
- Do not book, buy, pay, promise, negotiate, or accept an agreement.
- Do not use this workflow for emergencies or for medical, legal, or financial advice.
- Do not place a setup-time test call unless the user explicitly requests and authorizes it.

## Required inputs

Require all of the following before creating a live call plan:

- a short visit context containing only what venue staff need to hear;
- one to eight observable questions, each marked `must_verify` or `helpful_to_know`;
- one to three venue names and confirmed public-business E.164 numbers;
- the planned AI disclosure and action limits;
- an explicit authorization covering the exact venues, numbers, and questions.

Do not guess a number, country code, venue identity, condition, threshold, or user intent. Use reserved fictional numbers in examples and mask numbers in summaries.

## Preview before side effects

Default to a no-call preview. Show the user:

1. the visit context that will be disclosed;
2. each venue and masked destination number;
3. the exact questions in call order;
4. the AI identity and consent disclosure;
5. allowed and prohibited actions;
6. the data that may be retained;
7. the number of outbound calls the plan can create.

Editing the preview invalidates any earlier authorization. A live run must use an immutable snapshot of the final preview.

## Live call workflow

For each authorized venue, create at most one CALL-E call with a stable idempotency key:

1. Confirm that the destination is still the reviewed public-business number.
2. Introduce the caller as an AI assistant acting for a person planning a visit.
3. Confirm venue identity before sharing visit context.
4. Ask whether the respondent wishes to continue. End the call on decline.
5. Ask `must_verify` questions first, one observable condition at a time.
6. Permit only neutral clarification of an ambiguous answer.
7. Preserve `unknown`, `not_asked`, contradiction, silence, voicemail, and failure states.
8. Never treat provider completion as proof that a condition was confirmed.

Read [references/safety.md](references/safety.md) before a live run. Use [references/result-contract.md](references/result-contract.md) when normalizing output.

## Evidence workflow

Return one terminal claim for every planned condition. A claim may be `confirmed`, `does_not_match`, `unclear`, `not_asked`, `could_not_reach`, or `conflicting`.

`confirmed` requires all of these:

- venue identity was confirmed;
- the respondent accepted the conversation;
- the normalized answer semantically agrees with the condition or deterministic threshold;
- the supporting excerpt aligns to a respondent transcript turn.

If any requirement is missing, do not confirm. Include the question, venue, status, normalized staff report, respondent role when available, capture time, source class, freshness, evidence reference, and limitation. The user decides whether the result works for the visit.

## Retry and cancellation

- Reuse the same idempotency key and logically identical payload after an ambiguous network response.
- Never automatically redial voicemail, no-answer, decline, wrong number, failure, or a completed call.
- Queued work may be cancelled before provider creation.
- Do not promise active-call cancellation unless the selected CALL-E route has been verified to support it.
- A focused follow-up requires a new preview, authorization, snapshot, and call run. It never overwrites prior evidence.
- Keep a provider-create kill switch and a durable scheduler/reconciliation path outside the browser.

## Credentials and privacy

Keep CALL-E credentials and full destination numbers in the server-side execution environment. Never include secrets, full phone numbers, visit context, condition text, transcripts, or evidence excerpts in routine logs, analytics, issue comments, or commit messages. Recording is off unless a lawful deployment separately discloses it and obtains all required consent.

## Output

After a preview, report:

- `status: preview only`;
- venue count and masked numbers;
- exact questions and priorities;
- disclosure and action limits;
- expected call side effects;
- what must be authorized next.

After a live run, report:

- safe call references and terminal provider states;
- one condition-level claim per planned question;
- source, capture time, evidence availability, and freshness;
- explicit unknowns and conflicts;
- whether any follow-up is available;
- how to delete retained data.

Never claim that a call was created, completed, cancelled, or verified without runtime evidence from the selected host and provider.
