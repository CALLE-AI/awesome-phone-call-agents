# Contact Preference Guard

`contact-preference-guard` is a post-call Skill. It turns contact preferences expressed in a completed phone call into conservative, evidence-backed structured update proposals. The Skill returns proposals; it does not change contact records.

## Why it exists

A transcript can be understood correctly at the sentence level and still produce the wrong downstream rule:

- “Don't call me today” must not become permanent DNC.
- “Don't call me again about this order” must not become organization-wide DNC.
- “Text me instead” is a channel preference, not marketing consent.
- “I'm not interested” or a frustrated complaint is not automatically DNC.

## When to use it

Use the Skill after a CALL-E call has completed and a host may need to update contact preferences. Give the host agent the [Skill](../../skills/contact-preference-guard/SKILL.md), [output contract](../../skills/contact-preference-guard/references/preference-schema.md), and [safety rules](../../skills/contact-preference-guard/references/safety.md), together with the transcript and call context. The host, not the bundled Python demo, interprets the transcript.

Do not use it for live call intervention, legal consent decisions, real CRM integration, or placing calls.

## Input and output

Input requires `transcript` and `call_context.organization`, `.purpose`, and `.task`. `call_context.campaign` and `.current_preferences` are optional. No raw phone number is needed. A transcript can be recipient text or `{speaker, text}` dialogue turns.

The output can contain zero, one, or multiple proposals. An explicit company-wide request might produce:

```json
{
  "status": "preferences_detected",
  "preferences": [
    {
      "preference_type": "do_not_call",
      "value": true,
      "duration": "ongoing",
      "scope": "organization",
      "evidence": "You should never call me again from your company.",
      "confidence": "high",
      "requires_human_review": false,
      "recommended_action": "update_preference"
    }
  ]
}
```

The contract supports only `call_window`, `channel`, `language`, `do_not_call`, and `voicemail`. It defines the duration, scope, action and status enums. Evidence must quote the recipient.

## Interpretation rules

Use the **minimum scope** that explains the recipient's words. Explicit instructions beat inferred intent. Temporary conditions are not permanent rules. A preferred channel is not consent; product rejection and frustration alone are not contact suppression. Material ambiguity fails closed to `request_confirmation`. A later explicit correction overrides the earlier statement it corrects.

Keep two decisions separate:

```text
Unclear recipient meaning -> semantic clarification (`request_confirmation`)
Clear recipient meaning + consequential CRM change -> operator approval in the adapter
```

“You should never call me again from your company” clearly means ongoing organization-wide DNC. The Skill does not ask the recipient to confirm that meaning again. The adapter can still require an operator to approve `global_do_not_call: false -> true` before writing it.

## Run the local demo

Use Python 3.9+ from the repository root. These commands preview stored illustrative proposals; they do not run a model, place calls, or write by default:

```bash
# Explicit organization-wide DNC: previews global_do_not_call false -> true.
python3 skills/contact-preference-guard/demo/dry_run.py --input docs/contact-preference-guard/demo-global-dnc-input.json --proposal docs/contact-preference-guard/demo-global-dnc-proposal.json

# Temporary DNC: today, scoped to the current task.
python3 skills/contact-preference-guard/demo/dry_run.py --case today-only

# Task-scoped DNC: this order, not the whole organization.
python3 skills/contact-preference-guard/demo/dry_run.py --case order-only

# Ambiguous frustration: semantic review, no write offered.
python3 skills/contact-preference-guard/demo/dry_run.py --case complaint
```

The temporary and task-scoped cases leave `global_do_not_call` false. The demo marks fixture replay as such; it is not a language-accuracy test. To preview a newly interpreted call, save the host agent's actual proposal JSON and pass it with `--input` and `--proposal`.

Add `--confirm` to a command to request an explicit `approve` or `reject` after reviewing the before/after preview. The demo writes only the adjacent synthetic [`mock_crm.json`](../../skills/contact-preference-guard/demo/mock_crm.json), and only on `approve`. Semantic uncertainty blocks the whole batch. The Skill has no real CRM connection and causes no real calls, messages, consent changes, or CRM mutations. The CLI approval token is not an authenticated human identity check.

## Validation

- **35/35 core behavioral cases passed**.
- **12/12 supplemental synthetic evaluation cases passed**.
- **19/19 safety tests passed**.
- The recorded *encoded* Over-broad Update Rate was **0/35 core cases and 0/12 supplemental cases**. This checks defined scope, duration, action and consent-field conditions; it cannot detect every semantic expansion.

The [golden cases](../../skills/contact-preference-guard/tests/golden-test-cases.json), [supplemental cases](../../skills/contact-preference-guard/tests/supplemental-test-cases.json), [validator](../../skills/contact-preference-guard/scripts/validate.py), and [recorded outputs](evaluation/semantic-approval-fix/actual-results.json) are included for inspection. Re-score the saved model outputs and run the adapter tests:

```bash
python3 skills/contact-preference-guard/scripts/validate.py score --cases skills/contact-preference-guard/tests/golden-test-cases.json --actual docs/contact-preference-guard/evaluation/semantic-approval-fix/actual-results.json
python3 skills/contact-preference-guard/scripts/validate.py score --cases skills/contact-preference-guard/tests/supplemental-test-cases.json --actual docs/contact-preference-guard/evaluation/semantic-approval-fix/actual-results.json
python3 skills/contact-preference-guard/tests/test_safety.py
```

Scoring saved outputs does not rerun the model. These are synthetic behavioral evaluations and do not represent production accuracy on real phone calls. [The change report](SEMANTIC_APPROVAL_REVIEW.md) records the exact four-case correction and the test history.

## Limits

There is no real CALL-E end-to-end validation, real CRM integration, real-time clarification, legal consent determination, web app, or platform plugin. Relative time bounds are preserved as evidence, not resolved into schedules or enforced expiries.
