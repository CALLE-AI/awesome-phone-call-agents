# Semantic clarification and operator approval: targeted correction

The Skill now treats an explicit organization-wide ongoing DNC request as a definite
preference: `update_preference`, `requires_human_review: false`, and no recipient
clarification. The mock adapter separately requires operator approval before applying
`global_do_not_call: false -> true`. Execution impact no longer sets the semantic-review
flag. Five types, duration/scope enums, minimum-scope interpretation, preference versus
consent, business-intent exclusion and correction precedence are unchanged.

## Validation result

- **35/35 core behavioral cases passed** in a fresh model interpretation run.
- **12/12 supplemental synthetic evaluation** cases passed in the same fresh run.
- **4/4 exact requested regression cases passed**; Case A high confidence and absence
  of a clarification field were also checked against the actual model output.
- **19/19 adapter/validator safety tests passed** (the previous 16 with one obsolete
  assertion replaced, plus three targeted tests).

No other behavioral regression failed. These are limited synthetic checks; they do not
establish real-call generalization. The Python scorer compares saved actual model outputs
against assertions; the mock preview does not itself perform language interpretation.
A fresh-context agent received only the current Skill, schema, safety reference and 51
input objects. It did not receive expected answers or old results. This is author-run
synthetic evaluation, with shared filesystem and no independent human validation.

## Expected changes and the observed legacy failure

Only golden-02, golden-06 and golden-15 changed expected review/action/status fields,
explicitly to implement the user's new semantics. Their preference types, values, scope,
duration and inputs did not change. All other 32 expected core cases and all 12
supplemental cases are unchanged. Full before/after:
[expected-changes.json](evaluation/semantic-approval-fix/expected-changes.json).

After changing the implementation, the original 16 safety tests were run before editing
that test file. Exactly one failed: `test_global_dnc_cannot_bypass_review`, whose assertion
expected `validate()` to reject a definite global DNC proposal. The other 15 passed.
This failed assertion contradicted the newly requested policy; it was reported to the
user before replacement. Original failure output is preserved in
[old-safety-after-logic-change.stderr.txt](evaluation/semantic-approval-fix/old-safety-after-logic-change.stderr.txt).
No expected result was relaxed to hide an unrelated failure.

The replacement verifies that explicit global DNC is structurally accepted and creates
only an in-memory preview without semantic clarification. Three additions verify:

1. A semantically ambiguous item blocks a mixed batch containing explicit global DNC.
2. Explicit DNC withdrawal does not falsely require semantic clarification, but the
   adapter rejects clearing DNC as an unsupported execution operation. There is no new
   DNC-clearing feature; the previous execution boundary is retained at the correct layer.
3. The real CLI on a temporary clone cannot apply global DNC without both `--confirm`
   and an explicit `approve`. Default preview, a piped approve without --confirm,
   reject and EOF leave bytes unchanged; approve applies; repeated apply is a no-op.
   The semantic proposal remains unchanged throughout operator approval.

## Responsibility split

| Concern | Responsible layer | Behavior |
| --- | --- | --- |
| Meaning is uncertain | Skill; validator enforces structural uncertainty rules | `request_confirmation`, `requires_human_review: true`, reason and clarification; no mock write offered |
| Meaning is explicit | Skill | Definite proposal, no extra recipient clarification |
| Approving a file change, including global DNC | Mock CRM adapter `main()` | Show before/after, require --confirm and approve; do not alter semantic fields |
| Computing possible field changes | Adapter `preview()` | Pure in-memory mapping; global DNC only for organization + ongoing + true |
| Unsupported DNC clearing | Mock CRM adapter | Execution error, not semantic review; no write |

The approve token is an operator input convention, not authenticated proof of a human.
The Skill still never contacts a CRM, places a call, sends a message, creates consent,
or schedules a callback. The bundled mock file was not changed by validation; writes
were exercised only in temporary test copies.

## Four exact inputs: actual final model outputs

The source records below are copied without semantic editing from the fresh model run.
Unicode escapes preserve the repository's English-only source formatting; decoding
JSON recovers the exact user-requested Chinese input and quotes. Full inputs, outputs,
before/after and flags: [four-case-final-outputs.json](evaluation/semantic-approval-fix/four-case-final-outputs.json).

### CASE-A

```json
{
  "transcript": "\u4f60\u4eec\u516c\u53f8\u4ee5\u540e\u4e0d\u8981\u518d\u7ed9\u6211\u6253\u7535\u8bdd\u3002",
  "output": {
    "status": "preferences_detected",
    "preferences": [
      {
        "preference_type": "do_not_call",
        "value": true,
        "duration": "ongoing",
        "scope": "organization",
        "evidence": "\u4f60\u4eec\u516c\u53f8\u4ee5\u540e\u4e0d\u8981\u518d\u7ed9\u6211\u6253\u7535\u8bdd\u3002",
        "confidence": "high",
        "requires_human_review": false,
        "recommended_action": "update_preference"
      }
    ]
  }
}
```

Global DNC preview: `false -> true`. Semantic clarification: `false`. Operator approval needed before any resulting write: `true`. No write was executed in this preview.

### CASE-B

```json
{
  "transcript": "\u8fd9\u4e2a\u8ba2\u5355\u522b\u518d\u7ed9\u6211\u6253\u7535\u8bdd\u3002",
  "output": {
    "status": "preferences_detected",
    "preferences": [
      {
        "preference_type": "do_not_call",
        "value": true,
        "duration": "ongoing",
        "scope": "this_task",
        "evidence": "\u8fd9\u4e2a\u8ba2\u5355\u522b\u518d\u7ed9\u6211\u6253\u7535\u8bdd\u3002",
        "confidence": "high",
        "requires_human_review": false,
        "recommended_action": "update_preference"
      }
    ]
  }
}
```

Global DNC preview: `false -> false`. Semantic clarification: `false`. Operator approval needed before any resulting write: `true`. No write was executed in this preview.

### CASE-C

```json
{
  "transcript": "\u4eca\u5929\u522b\u6253\u4e86\u3002",
  "output": {
    "status": "preferences_detected",
    "preferences": [
      {
        "preference_type": "do_not_call",
        "value": true,
        "duration": "time_bounded",
        "scope": "this_task",
        "evidence": "\u4eca\u5929\u522b\u6253\u4e86\u3002",
        "confidence": "high",
        "requires_human_review": false,
        "recommended_action": "update_preference",
        "time_bound": "\u4eca\u5929"
      }
    ]
  }
}
```

Global DNC preview: `false -> false`. Semantic clarification: `false`. Operator approval needed before any resulting write: `true`. No write was executed in this preview.

### CASE-D

```json
{
  "transcript": "\u4f60\u4eec\u600e\u4e48\u5929\u5929\u7ed9\u6211\u6253\u7535\u8bdd\uff0c\u70e6\u6b7b\u4e86\u3002",
  "output": {
    "status": "review_required",
    "preferences": [
      {
        "preference_type": "do_not_call",
        "value": null,
        "duration": "unknown",
        "scope": "unknown",
        "evidence": "\u4f60\u4eec\u600e\u4e48\u5929\u5929\u7ed9\u6211\u6253\u7535\u8bdd\uff0c\u70e6\u6b7b\u4e86\u3002",
        "confidence": "low",
        "requires_human_review": true,
        "recommended_action": "request_confirmation",
        "review_reason": "\u9488\u5bf9\u91cd\u590d\u6765\u7535\u7684\u62b1\u6028\u53ef\u80fd\u8868\u8fbe\u62d2\u63a5\u610f\u56fe\uff0c\u4f46\u6ca1\u6709\u660e\u786e\u662f\u5426\u505c\u6b62\u6765\u7535\u4ee5\u53ca\u6301\u7eed\u65f6\u95f4\u548c\u8303\u56f4\u3002",
        "suggested_clarification": "\u60a8\u662f\u5e0c\u671b\u505c\u6b62\u54ea\u4e9b\u6765\u7535\uff1a\u672c\u6b21\u8ba2\u5355\u3001\u6b64\u6b21\u6d3b\u52a8\uff0c\u8fd8\u662f\u672c\u516c\u53f8\u6240\u6709\u7535\u8bdd\uff1f\u5e0c\u671b\u6682\u505c\u591a\u4e45\uff1f"
      }
    ]
  }
}
```

Global DNC preview: `false -> false`. Semantic clarification: `true`. Operator approval needed before any resulting write: `false`. No write was executed in this preview.

## Commands and complete machine reports

Run from the repository root. The recorded shell executions use Python standard library
and no network. `commands-and-results.json` preserves full stdout/stderr and exit codes,
including all per-case comparisons and the 19 test method names.

```bash
python3 skills/contact-preference-guard/scripts/validate.py score --cases skills/contact-preference-guard/tests/golden-test-cases.json --actual docs/contact-preference-guard/evaluation/semantic-approval-fix/actual-results.json
python3 skills/contact-preference-guard/scripts/validate.py score --cases skills/contact-preference-guard/tests/supplemental-test-cases.json --actual docs/contact-preference-guard/evaluation/semantic-approval-fix/actual-results.json
python3 skills/contact-preference-guard/scripts/validate.py score --cases skills/contact-preference-guard/tests/semantic-approval-cases.json --actual docs/contact-preference-guard/evaluation/semantic-approval-fix/actual-results.json
python3 skills/contact-preference-guard/tests/test_safety.py -v
```

- [Actual model results](evaluation/semantic-approval-fix/actual-results.json).
- [Raw evaluation inputs without answers](evaluation/semantic-approval-fix/inputs.json).
- [Instruction hashes and provenance](evaluation/semantic-approval-fix/provenance.json).
- [Core behavioral report](evaluation/semantic-approval-fix/golden-report.json).
- [Supplemental synthetic evaluation report](evaluation/semantic-approval-fix/supplemental-report.json).
- [Four exact case report](evaluation/semantic-approval-fix/semantic-approval-report.json).
- [Complete command results](evaluation/semantic-approval-fix/commands-and-results.json).

The existing scorer and its limitations were not redesigned. It checks case-level
fields, and only checks values where expected contains a value assertion. The encoded
over-broad update rate remains partial; it is not a semantic proof.

### golden metrics

```json
{
  "type_accuracy": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  },
  "duration_accuracy": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  },
  "scope_accuracy": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  },
  "action_accuracy": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  },
  "false_positive_rate": {
    "numerator": 0,
    "denominator": 6,
    "rate": 0.0
  },
  "ambiguity_handling": {
    "numerator": 6,
    "denominator": 6,
    "rate": 1.0
  },
  "multi_preference_handling": {
    "numerator": 3,
    "denominator": 3,
    "rate": 1.0
  },
  "over_broad_update_rate": {
    "numerator": 0,
    "denominator": 35,
    "rate": 0.0
  },
  "contract_validity": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  },
  "case_pass_rate": {
    "numerator": 35,
    "denominator": 35,
    "rate": 1.0
  }
}
```

### supplemental metrics

```json
{
  "type_accuracy": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  },
  "duration_accuracy": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  },
  "scope_accuracy": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  },
  "action_accuracy": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  },
  "false_positive_rate": {
    "numerator": 0,
    "denominator": 3,
    "rate": 0.0
  },
  "ambiguity_handling": {
    "numerator": 1,
    "denominator": 1,
    "rate": 1.0
  },
  "multi_preference_handling": {
    "numerator": 1,
    "denominator": 1,
    "rate": 1.0
  },
  "over_broad_update_rate": {
    "numerator": 0,
    "denominator": 12,
    "rate": 0.0
  },
  "contract_validity": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  },
  "case_pass_rate": {
    "numerator": 12,
    "denominator": 12,
    "rate": 1.0
  }
}
```

### semantic-approval metrics

```json
{
  "type_accuracy": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  },
  "duration_accuracy": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  },
  "scope_accuracy": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  },
  "action_accuracy": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  },
  "false_positive_rate": {
    "numerator": 0,
    "denominator": 0,
    "rate": null
  },
  "ambiguity_handling": {
    "numerator": 1,
    "denominator": 1,
    "rate": 1.0
  },
  "multi_preference_handling": {
    "numerator": 0,
    "denominator": 0,
    "rate": null
  },
  "over_broad_update_rate": {
    "numerator": 0,
    "denominator": 4,
    "rate": 0.0
  },
  "contract_validity": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  },
  "case_pass_rate": {
    "numerator": 4,
    "denominator": 4,
    "rate": 1.0
  }
}
```

### Safety test output

```text
test_agent_speech_cannot_supply_evidence (__main__.SafetyTests.test_agent_speech_cannot_supply_evidence) ... ok
test_ambiguity_blocks_even_explicit_global_dnc_in_mixed_batch (__main__.SafetyTests.test_ambiguity_blocks_even_explicit_global_dnc_in_mixed_batch) ... ok
test_cli_preview_reject_approve_and_repeat_in_isolated_copy (__main__.SafetyTests.test_cli_preview_reject_approve_and_repeat_in_isolated_copy) ... ok
test_consent_fields_rejected (__main__.SafetyTests.test_consent_fields_rejected) ... ok
test_explicit_global_dnc_needs_no_semantic_clarification (__main__.SafetyTests.test_explicit_global_dnc_needs_no_semantic_clarification) ... ok
test_explicit_withdrawal_is_not_uncertain_but_adapter_cannot_clear_dnc (__main__.SafetyTests.test_explicit_withdrawal_is_not_uncertain_but_adapter_cannot_clear_dnc) ... ok
test_fabricated_evidence_rejected (__main__.SafetyTests.test_fabricated_evidence_rejected) ... ok
test_global_dnc_cli_requires_operator_approve (__main__.SafetyTests.test_global_dnc_cli_requires_operator_approve) ... ok
test_missing_context_is_not_successful_empty_result (__main__.SafetyTests.test_missing_context_is_not_successful_empty_result) ... ok
test_missing_temporary_bound_rejected (__main__.SafetyTests.test_missing_temporary_bound_rejected) ... ok
test_repeat_is_idempotent (__main__.SafetyTests.test_repeat_is_idempotent) ... ok
test_review_blocks_entire_mixed_batch (__main__.SafetyTests.test_review_blocks_entire_mixed_batch) ... ok
test_scorer_flags_broadening (__main__.SafetyTests.test_scorer_flags_broadening) ... ok
test_scorer_requires_actual_complete_unique_results (__main__.SafetyTests.test_scorer_requires_actual_complete_unique_results) ... ok
test_task_dnc_does_not_become_organization_dnc (__main__.SafetyTests.test_task_dnc_does_not_become_organization_dnc) ... ok
test_temporary_channel_uses_scoped_record_not_scalar (__main__.SafetyTests.test_temporary_channel_uses_scoped_record_not_scalar) ... ok
test_temporary_dnc_retains_bound_and_never_sets_global (__main__.SafetyTests.test_temporary_dnc_retains_bound_and_never_sets_global) ... ok
test_this_call_cannot_update_future_state (__main__.SafetyTests.test_this_call_cannot_update_future_state) ... ok
test_wrong_organization_cannot_change_mock (__main__.SafetyTests.test_wrong_organization_cannot_change_mock) ... ok

----------------------------------------------------------------------
Ran 19 tests in 0.520s

OK
```

## Files changed and historical evidence

Modified existing files:

- `skills/contact-preference-guard/SKILL.md`
- `skills/contact-preference-guard/references/preference-schema.md`
- `skills/contact-preference-guard/references/safety.md`
- `skills/contact-preference-guard/references/examples.md`
- `skills/contact-preference-guard/scripts/validate.py`
- `skills/contact-preference-guard/demo/dry_run.py`
- `skills/contact-preference-guard/tests/golden-test-cases.json`
- `skills/contact-preference-guard/tests/test_safety.py`
- `docs/contact-preference-guard/README.md`

Added only verification/report material:

- `skills/contact-preference-guard/tests/semantic-approval-cases.json`
- This report and `evaluation/semantic-approval-fix/` outputs, provenance and logs.

The 12 supplemental test definitions, four existing illustrative demo fixtures,
`demo/mock_crm.json`, and all historical evaluation outputs/reports are unchanged.
Historical reports describe the previous semantics and are labeled as such in the README;
they are not overwritten or presented as current results. The previously exported review
ZIP remains an immutable snapshot of that older implementation.
