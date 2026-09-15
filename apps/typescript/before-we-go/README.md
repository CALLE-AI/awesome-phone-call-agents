# Before We Go — customer enquiry callback

A focused CALL-E reference app: a customer asks about a planned restaurant visit; a disclosed AI restaurant representative calls back using a **fictional versioned fact sheet**, captures the customer's needs, and prepares unresolved questions for staff review. The callee is the customer, not restaurant staff.

This is a local CLI companion to the [web prototype](https://github.com/Sravanalaxmi05/before-we-go). It needs no Sites account, database service, private package, or live credential for its default demo.

## Setup and no-call preview

Node.js24+ is required. No dependency installation is needed. From this directory:

```bash
node --experimental-strip-types index.ts
node --experimental-strip-types --test tests/*.test.ts
```

The default `sample` prints an explicitly synthetic reviewed handoff. It does not make a network request, create a live call, or prove a real conversation.

## Opt-in live verification

Set `CALLE_API_KEY`, `TEST_RECIPIENT` (a consenting number you own or are authorized to call in E.164 format), `TEST_REGION` and `TEST_LOCALE` in your server environment. `.env.example` contains empty placeholders. Node can load a local ignored file with `--env-file=.env.local`. Check [current region/language support](https://docs.heycall-e.com/regions); valid E.164 formatting does not guarantee delivery.

```bash
node --env-file=.env.local --experimental-strip-types index.ts preview "Can you explain step-free seating and toilet facilities for Sunday lunch?"
# Read the exact task and masked recipient. Then substitute the returned plan ID:
node --env-file=.env.local --experimental-strip-types index.ts start PLAN_ID --confirm-real-call --consented
node --env-file=.env.local --experimental-strip-types index.ts status PLAN_ID
# Review full customer/AI transcript and the fictional fact sheet before exporting:
node --experimental-strip-types index.ts report PLAN_ID --reviewed
```

The start command places **one real outbound call** and can consume provider credits. Consent must include this purpose and transcription; do not cold-call businesses or customers. The prompt discloses AI and asks willingness to continue. Refusal is retained and suppresses future starts for the recipient. No phone numbers or keys appear in normal summaries. The private SQLite file includes the recipient and payload: keep `.local/` private and out of Git. Do not publish live transcripts without separate permission.

## Result and grounding

Customer preferences are supported only by recipient-speaker quotes. AI explanations have separate bot-speaker excerpts and must be checked against the persisted fact sheet. Exact substring matches establish provenance, not truth or semantic correctness. General unanswered questions (hours/menu/parking and others) are retained alongside access needs. Unknown facts stay unknown; there is no booking, live seating inventory, accessibility certification, medical/legal/financial advice, emergency handling, or actual staff-message delivery.

The generated report **prepares a handoff**. A person must deliver or act on it. It does not claim assignment to a CRM or a promised callback time.

Phone-like text is masked in normalized results before storage, normal status output,
and reviewed exports. Quote provenance is matched before masking. This is limited
phone-output minimization, not a guarantee to redact names or all personal details;
keep reports private. Existing local records are masked when displayed, not rewritten.

## Side effects, duplicate prevention and cancellation

Preview only stores a ten-minute local plan. Start atomically claims it and obtains a per-recipient SQLite mutex before network dispatch. The idempotency key stays bound to the immutable payload. There are no recurring schedules, automatic redials, hidden jobs, refunds or paid top-ups. Provider-side dial-attempt behavior is not independently verified.

Before start, cancel simply by not starting; the plan expires. After start, closing the CLI **does not cancel the call**. This app has no active-call cancellation endpoint. Reopen `status` with the saved ID. A network/HTTP ambiguity stays locked for manual operator reconciliation using CALL-E's [same-key/same-payload recovery procedure](https://docs.heycall-e.com/calls). Never delete state to get around a lock or suppression. Recovery can initiate the original authorized call if it was never accepted; only an informed operator should perform it. No recovery command is exposed here.

## Verification status and limitations

Default tests use fictional data and mocked transport. The parent web app's production Worker made an authorized test request on10September2026: CALL-E accepted a task, but its single attempt failed and the entrant's mobile did not ring. No completed live conversation or valid live handoff is claimed. This portable CLI has not been separately dial-tested. Successful end-to-end conversation and hackathon judging access remain release requirements.

The SQLite database is local only. This is a single-operator demonstration, not a production customer callback service. Use one terminal at a time for status/review. Follow-up work includes verified live delivery, stricter grounded-answer evaluation and production recipient verification.
