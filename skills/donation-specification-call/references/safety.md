# Safety

`donation-specification-call` collects missing donation facts. It does not inspect goods or make allocation decisions.

## Authorisation And Consent

A stored phone number is not authorisation. Place a call only when the contact record explicitly contains active consent for `donation_specification`, the question set is tied to the current batch, the authorisation has not expired, and the recipient organisation has also approved the inquiry.

Authorisation is consumed by the first dispatch attempt. A timeout or lost response must be reconciled with the same provider call ID or idempotency key; it must not create another call.

## Disclosure

Open by stating that this is an automated call, naming the organisation represented, and explaining that the purpose is to complete missing donation information. Never pretend to be a person. Ask whether the recipient is willing to continue. If they refuse or withdraw consent, thank them, stop, and record `refusal`.

## Question Boundary

Ask only the operator-reviewed questions bound to known subject and attribute pairs. Do not add rapport questions, request beneficiary information, negotiate commitments, or ask for unrelated operational details.

## Claim Boundary

Phone answers may become `donor_reported` or `recipient_reported` claims only.

Never create any of the following from a phone answer:

- `physically_inspected` or `certified` status;
- electrical, mechanical, food, hygiene, or medical safety approval;
- proof of data erasure;
- proof of legal title or ownership;
- software-licence entitlement;
- authenticity of supporting documents;
- an approved allocation, collection booking, or ownership transfer.

If a reported answer contradicts an existing claim, store both with conflict status. Do not overwrite the earlier record.

## Evidence And Validation

Each accepted non-null attribute must include a supporting quote attributable to the intended contact. Reject:

- unknown subject references;
- attributes that were not asked;
- attributes absent from the category schema;
- invalid types, units, enum members, dates, ranges, or quantities;
- inferred values that the recipient did not state;
- results from voicemail, the wrong person, or withdrawn consent.

Unknown remains unknown. Do not replace it with zero, false, an empty string, or a likely value.

## Privacy And Credentials

Use opaque references such as `ITEM-SCHOOL-01`. Avoid donor addresses, pupil names, beneficiary information, or personal circumstances. Mask phone numbers in previews, logs, screenshots, fixtures, and summaries. Keep CALL-E credentials and the actual live destination server-side.

## Side Effects, Cost, And Cancellation

- Preview and fixture modes place no calls and require no credentials.
- Live mode creates one potentially billable outbound call.
- This skill has no scheduler and no recurring job.
- Before dispatch, cancellation means do not confirm the preview.
- After dispatch, do not promise provider-side cancellation. Reconcile the existing call and do not redial automatically.

## Stop Conditions

Stop when authorisation is missing or expired, the question-set hash changed, the person or role is wrong, consent is refused or withdrawn, the schema fails, the provider outcome is unknown, or the conversation enters an emergency or regulated-advice topic.

Do not use this workflow for injury, fire, gas, electrical danger, medical advice, or emergency response.
