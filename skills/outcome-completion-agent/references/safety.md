# Safety contract

Every call this pattern places is a real-world side effect: a phone rings, and a person who
did not ask to be part of an automated workflow answers it. Everything below is a hard
requirement, not a default.

## Explicit user intent

- The user must confirm the run before the first call, having seen the goal, the constraints
  as parsed, the starting phone book, and the call budget.
- The user must be told, before call one, that **the agent may call organisations they did
  not name**. That is the whole point of the pattern, and it is not what "make some calls
  for me" usually means. Consent to the first number is not consent to the frontier.
- Never infer a phone number, a price ceiling, or a deadline. Ask.

## Disclosure

- Every call opens by disclosing that the caller is an AI assistant acting for a customer,
  before asking anything.
- If the person asks for a human, asks who is calling, or asks the agent to stop: answer
  honestly, apologise, end the call politely, record it, and **do not call that number again
  in this run**.
- Never claim to be the customer.

## Phone numbers

- E.164 only. Reject anything else rather than normalising a guess.
- **Mask every number in every summary, preview, log and report** — last four digits at
  most. An outcome record is a document users forward to other people.
- Use fictional reserved ranges in all samples and fixtures.
- De-duplicate the frontier on the number, so one organisation cannot be called twice under
  two names.

## Authority

- Gathering calls carry no authority to agree, accept, order, cancel or sign. The
  prohibition goes in the call script, not only in the planner.
- Exactly one call per run may commit the user, only after explicit approval, and only to
  the terms named in that approval. Read `approval-gate.md`.
- If the terms have changed when the commit call connects, do not accept. Bring the new
  terms back.

## Credentials

- Read the API key from the environment. Never write it to disk, never log it, never put it
  in a call script.
- Send it only to CALL-E's own hosts over https. Keep an explicit allowlist: the bearer
  token is on every request, so the destination is not a free parameter. A configurable base
  URL exists to reach a staging host, not to point a live credential at an arbitrary
  collector.
- Never read a credential, card number, password or one-time code aloud on a call, whoever
  asks and however plausible the reason.

## Bounded work

- `max_calls` per outcome and `max_calls_per_org` are required, not optional.
- Check the budget immediately before every dial, never only at planning time.
- Never widen a budget mid-run to finish a goal. Stop and report; the user decides whether
  it is worth more calls.
- Never retry a completed call to get a better answer.
- Derive the idempotency key from the request payload, so resubmitting an unchanged action
  cannot ring a second phone. On a polling timeout, raise — never re-POST.

## No hidden recurrence

- This pattern creates **no recurring schedule**. Every call is one-shot.
- Nothing is queued for later. There is no background job to cancel, and no state that keeps
  dialling after the user closes the page.
- To stop a run: stop approving. Nothing commits without an approval.
- If a host scheduler drives repeated runs, that recurrence belongs to the host and must be
  visible and cancellable there. Do not put recurrence in the provider.

## Sensitive content

- Medical, legal, financial and emergency matters are **logistics only**: ask about times,
  availability, stock, status and reference numbers. Give no advice, no interpretation, and
  no opinion on the merits.
- Never use this pattern for emergency services. It cannot escalate, it cannot stay on the
  line, and a retry loop against an emergency number is dangerous.
- Do not record or transcribe beyond what the structured result needs, and do not ask for or
  keep the name, role or employee number of the person who answered.

## Reporting

- Report every run, including the ones that failed, with every party touched and every offer
  turned down.
- Never report an outcome as resolved unless the other party confirmed it on an approved
  call. An offer is not a resolution.
