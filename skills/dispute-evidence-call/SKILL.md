---
name: dispute-evidence-call
description: Place one disclosed confirmation phone call to a customer who disputed a card charge, and use the answers as chargeback evidence only when the transcript shows the customer actually said them. Use when a merchant needs customer communication for a dispute and there is no email thread.
---

# Dispute Evidence Call

Use this skill when a merchant is answering a card dispute (a chargeback), has no written
correspondence with the customer, and wants the customer's own words as customer-communication
evidence. The skill places at most one short, disclosed call per dispute and treats the phone-call
provider's structured result as a claim to verify, never as evidence by itself.

Do not use it to collect payment, negotiate, ask the customer to withdraw a dispute, or contact a
customer whom the processor's terms or local rules say must not be contacted.

## Workflow

1. Take every input from the dispute and the order record: dispute id, order id, a short item
   summary, the amount, the merchant name and the customer's phone number on record. Never take a
   destination from chat text, an email body or model output.
2. Preview first. Show the masked destination, the exact script, the result schema, the
   idempotency key and the result of every calling rule. Place no call during a preview.
3. Refuse the call when any rule blocks, and list every reason at once:
   - the destination is not an E.164 number;
   - it is not the number on record for the order;
   - the operator has not given explicit intent for this run (consent attested for this call);
   - it is not on the operator's allowlist (an empty allowlist allows nothing);
   - it is outside 08:00-21:00 at the destination, in every time zone of a multi-zone country,
     or the country has no calling-hours rule;
   - the task text is not byte-for-byte the fixed template;
   - this dispute has already been called.
4. Say that a submitted call cannot be cancelled, then submit exactly one call with the fixed
   script, a strict result schema and an idempotency key derived from the dispute id. Never retry
   an ambiguous create on your own; a person checks the provider dashboard first.
5. Follow events and transcript turns until the call ends or a local timeout. Stopping locally does
   not stop the call.
6. Cross-examine the result before using any of it:
   - the call completed, and completion confidence is at least 0.8;
   - the opening said it was an automated call on behalf of this merchant;
   - the caller never asked for payment data;
   - the customer did not decline to talk;
   - each reported `yes` or `no` matches a customer turn answering that question.
7. Decide in this order. A reported `no` to either question stops the filing, grounded or not. A
   `yes` is used only when it is grounded and every call check passed. Anything else is not filed.
8. Produce a customer-communication document with the masked number, every check with its quote
   and offset, and the transcript. Keep it local; a person files it with the processor.

## Script contract

The script is a template, not generated text. It opens with the disclosure ("an automated
assistant calling on behalf of the merchant about your order, this call may be recorded"), asks
whether the order was received and whether the charge is recognised, one question at a time, and
ends the call at once if the person does not want to talk. It never asks for card numbers,
security codes, passwords or bank details, and never mentions banks, chargebacks or disputes.

## Implementation

Use [`../../apps/python/rebuttal-dispute-call/`](../../apps/python/rebuttal-dispute-call/) for the
runnable implementation with CALL-E. Its preview and dry-run paths place no call.

```bash
cd apps/python/rebuttal-dispute-call
pip install -r requirements.txt
python -m rebuttal_dispute_call preview
python -m rebuttal_dispute_call dry-run --scenario ungrounded
```

Read [references/safety.md](references/safety.md) before any live call, and read
[references/examples.md](references/examples.md) when deciding what a finished call supports.
