---
name: donation-specification-call
description: Collect only the missing attributes blocking a donation allocation through one previewed, authorised CALL-E phone call, returning schema-validated reported claims without treating the conversation as inspection or certification.
license: MIT
---

# Donation Specification Call

This is the reusable phone workflow behind [The Missing Call](https://github.com/venvennnn/readykit), a category-neutral donation matching and fulfilment engine.

Use it when donated goods cannot be matched safely because a required real-world attribute is unknown. Examples include the age range on school supplies, labelled clothing sizes, furniture dimensions, whether goods are packed, available quantities, or whether a required document exists.

The skill asks one authorised contact only the questions currently blocking the match. It returns evidence-linked **reported claims** for human review. It does not inspect an item, certify its safety, approve an allocation, promise collection, transfer ownership, or prove that a document is genuine.

The governing rule is:

> A completed call is not a completed match, and a spoken answer is not an inspection.

## When To Use

Use this skill when all of the following are true:

- a donation offer, recipient request, warehouse record, or transport offer has an unknown hard attribute;
- that unknown value prevents deterministic compatibility or bundle assembly;
- the contact has consented to calls for this specific donation-specification purpose;
- the recipient organisation has authorised the question set;
- a human operator can preview the exact call before dispatch.

This workflow is category-neutral. It can ask about any attribute defined in the host application's category schema, including quantities, dimensions, sizes, age ranges, packing state, collection windows, accessory presence, or documentary evidence.

## When Not To Use

Do not use it when:

- the phone number is merely present in a CSV, email signature, comment, directory, or public website;
- the contact or recipient organisation has not authorised the call;
- the operator has not reviewed the exact questions;
- the intended result requires physical inspection, legal judgement, safety certification, proof of ownership, medical advice, or regulatory approval;
- a previous attempt has an unknown outcome and has not been reconciled;
- the requested action is to book transport, transfer ownership, purchase goods, or promise an allocation;
- the situation involves an injury, fire, gas leak, electrical danger, or another emergency.

## Required Input

The host must provide:

- `batch_reference`: opaque donation-offer or request reference;
- `contact_reference`: authorised contact identifier;
- `contact_masked`: masked display number;
- `contact_role`: donor, recipient, warehouse, transport, or coordinator role;
- `organisation_name`: organisation represented on the call;
- `authorised_purpose`: exactly `donation_specification`;
- `authorisation_version` and expiry;
- `recipient_organisation_authorised`: boolean;
- `consent_to_call`: boolean;
- `subjects`: opaque item or batch references with allowed attributes;
- `questions`: only the unresolved hard attributes, including why each answer matters;
- a closed `recipient_result_schema`.

Never place personal names, street addresses, pupil details, beneficiary details, or unmasked phone numbers in the task when opaque references are sufficient.

## Core Workflow

1. **Find the blocking gaps.** Run deterministic matching first. Select only unknown hard attributes that prevent a match.
2. **Bind the questions.** Every question must map to one known `subject_reference` and one attribute allowed by that subject's category schema.
3. **Verify authorisation.** Confirm active contact consent, recipient-organisation approval, purpose, question-set hash, and expiry.
4. **Reserve idempotency.** Derive a stable key from `batch_reference + contact_reference + authorisation_version + question_set_hash` and persist call intent before dispatch.
5. **Preview.** Show the masked destination, AI disclosure, purpose, exact questions, result schema, likely side effect, and the fact that no call has yet been placed.
6. **Require confirmation.** Stop unless the operator explicitly approves this exact preview.
7. **Place one call.** Send the reviewed task and closed result schema to CALL-E. Store the provider call ID immediately.
8. **Reconcile.** Poll or process the webhook for that existing call. A timeout means `outcome_unknown`; reuse the provider ID or idempotency key and never redial blindly.
9. **Validate.** Reject unknown subjects, unasked attributes, invalid types or units, impossible quantities, and values without a supporting quotation.
10. **Store claims.** Accepted answers become `donor_reported` or `recipient_reported` claims. Conflicting claims remain visible; history is never overwritten.
11. **Re-run matching.** The host application decides whether the newly reported values remove the gap. Human approval still controls allocation and handoff.

```text
gap -> authorised questions -> preview -> confirm -> one call -> reconcile
    -> validate evidence -> reported claims -> re-run match -> human decision
```

## CALL-E Task Contract

Use CALL-E's currently documented create-call fields:

- `task`
- `recipients`
- `recipient_result_schema`
- `metadata`
- `idempotency_key`

The task must disclose that it is an automated call on behalf of the named organisation and state that the purpose is to complete missing donation information. Ask questions one at a time. Do not improvise unrelated questions. Stop immediately if consent is withdrawn.

The generic result contains:

- `reached_intended_contact`: `yes | no | unknown`
- `contact_role_confirmed`: `yes | no | unknown`
- `consent_continued`: `yes | no | unknown`
- `subject_references`: opaque subjects discussed
- `attribute_updates[]`: subject, attribute, value, unit, and supporting quote
- `availability_windows[]`
- `unanswered_questions[]`
- optional `notes`

Use `assets/example-donation.json` for the closed example contract. Run `scripts/preview_specification_call.py` to inspect the complete no-call plan. Pass `--result assets/example-result.json` to demonstrate conservative result reconciliation without telephony.

## Result Handling

Keep these outcomes distinct:

- no answer;
- voicemail;
- wrong person;
- refusal;
- partial answer;
- complete answer;
- conflicting answer;
- provider failure;
- outcome unknown.

Only apply an attribute when the intended role was reached, consent continued, the subject and attribute were pre-authorised, the value passes the category rule, and a supporting quote exists. Otherwise return an explicit rejection or unresolved field.

Do not convert confidence, tone, or fluency into a higher verification level. A certain-sounding speaker still produces a reported claim.

## Safety And Side Effects

Read `references/safety.md` before any live call.

- Preview and fixture replay place no calls.
- Live execution creates at most one billable outbound call for one authorisation.
- There is no recurring schedule.
- Cancellation means stopping before operator confirmation; after dispatch, reconcile the existing call rather than creating another.
- Phone numbers must be masked in logs and summaries.
- Credentials remain server-side.

## Output

Return:

- whether a call was placed;
- masked contact and batch reference;
- call outcome;
- accepted reported claims with supporting quotes;
- rejected fields with reasons;
- conflicts and unanswered questions;
- verification level for every accepted claim;
- idempotency key or stored provider reference;
- the next human-owned action.

Never state that an item is safe, certified, inspected, wiped, licensed, owned, allocated, or scheduled merely because someone said so by phone.
