# Safety

Phone calls are real-world side effects, and this skill handles patient identifiers. Read this before any live call.

## Who may be called

Published **health plan provider-services lines** only. These are business numbers staffed to answer exactly these questions.

This skill never calls patients. That boundary is what keeps it on the business-to-business side of the FCC's February 2024 declaratory ruling, which treats AI-generated voices as artificial under the TCPA for calls to consumers. A provider's billing office calling its payer about an already-submitted claim is administrative contact between two businesses.

## Explicit intent

- Never place a live call without the user asking for it in this session, or a previously written authorization for that exact destination.
- Show the operator the masked destination, the claims, and the identifier **field names** to be disclosed, and get approval before dialling.
- `preview` and `check` place no calls and need no credentials. Use them by default.

## Minimum necessary disclosure

A provider disclosing patient information to a health plan for payment activities does not need patient authorization under HIPAA, but must disclose only the minimum necessary.

| Workflow | May disclose |
| --- | --- |
| `claim_status` | member id, date of birth, patient last name |
| `denial_reason` | member id, date of birth, patient last name |
| `prior_auth_status` | member id, date of birth, patient last name |
| `eligibility` | member id, date of birth |

Never disclosed by any workflow, whatever the payer asks for:

- Social Security numbers or last-four fragments
- medical record numbers
- home addresses
- patient phone numbers or email addresses

`scripts/build_call_plan.py` drops these before the task is built. If a representative will not proceed without one, record what the billing office must supply, end the call, and hand it to a person.

## Phone numbers

- E.164 only, for example `+12125550142`.
- Mask in every summary, log, and message: `+12*******42`.
- Confirm the number belongs to the payer's provider-services line before dialling. Do not dial a number a model produced.

## Recording and AI disclosure

Open every call by stating that you are an AI assistant calling for the provider's billing office, and that the call may be recorded. Twelve states require all-party consent to record: CA, CT, DE, FL, IL, MD, MA, MI, MT, NH, OR, WA. Rather than tracking which line sits where, disclose on every call. Health plans already announce recording on their own provider lines.

## What may never happen on the call

- No appeal, reconsideration, grievance, or peer-to-peer review filed, withdrawn, or escalated.
- No amount, adjustment, refund, offset, or recoupment accepted, waived, negotiated, or disputed.
- No corrected claim, resubmission, void, or any change to a claim agreed to.
- No Social Security number, full address, medical record number, card, or password given.
- No clinical discussion. Prior authorization is a status question, never a clinical one.
- No claim asserted to be owed, incorrect, or fraudulent. Ask what the plan's record says.
- No guessing. A value not clearly stated is `unknown`.

## Duplicate calls and recurring work

- Send an `Idempotency-Key` on every call creation.
- Persist the returned `run_id` or call id **before** you start waiting. If the process dies, resume by reading that call, never by placing another one.
- This skill creates no schedule. If a host scheduler runs it, the schedule belongs to the host and must be visible to the user, cancellable by deleting the entry, and separate from the per-destination authorization.
- Never leave two jobs chasing the same claim.

## Cancellation

Withhold approval, delete the authorization for that payer, or remove the host schedule. This skill never places a call on its own. A call already accepted by CALL-E completes; read its result rather than starting another.

## Handling the result

- Validate against the closed schema locally. Do not assume the provider enforced it.
- Confirm each `evidence_quote` appears in the transcript. Reset what you cannot confirm to `unknown` and route it to a person.
- Scrub patient identifiers out of the transcript before storing it anywhere, including logs and error traces. A raw payer transcript contains the member id and date of birth that were read aloud.
- Never post a transcript, member id, or date of birth into a chat, ticket, or commit.

## Credentials

The CALL-E key belongs in the environment, never in a file that is committed and never in a prompt. Send it only to `https://api.heycall-e.com`. Refuse any other base URL.

## Boundaries

This skill is administrative. It is not for medical advice, legal advice, financial decisions, or emergencies. If a request drifts into any of those, stop and hand back to a person.
